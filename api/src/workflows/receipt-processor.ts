import { Env, AiProvider } from '../types';
import { analyzeReceiptImage, analyzeReceiptPdf, analyzeReceiptEmail, setAnthropicBaseUrl, setAnthropicModel } from '../services/receipt-analyzer';
import { generateId, decryptValue } from '../utils/crypto';
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import {
  isCreditExhaustionError,
  classifyBothProvidersFailed,
  classifySingleProviderFailed,
  parseBothProvidersFailed,
  parseSingleProviderFailed,
} from './credit-classification';
import { runWithFallback } from './provider-fallback';

interface ReceiptWorkflowParams {
  receiptId: string;
  bookId: string;
  userId: string;
  imageKey?: string;
  emailBody?: string;
  emailSubject?: string;
  emailFrom?: string;
}

// User keys are encrypted with userId as the per-user salt context (see routes/auth.ts).
// decryptValue must be called with the same context or it silently fails.
// Provider value stored while NO provider can take a scan (as opposed to a
// fallback provider's name while one is carrying them). Drives the
// "scans are waiting for credits" form of the Settings notice.
const NO_PROVIDER = 'none';

async function markAllProvidersOutOfCredits(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET ai_fallback_since = COALESCE(ai_fallback_since, datetime('now')), ai_fallback_provider = ? WHERE id = ?"
  ).bind(NO_PROVIDER, userId).run().catch((e) => console.error('[Receipt] could not record credit notice:', e));
}

async function resolveKey(
  prov: AiProvider,
  userId: string,
  user: { anthropic_api_key: string | null; openai_api_key: string | null; weavehub_ai_key: string | null } | null,
  env: Env,
): Promise<string | null> {
  const encrypted = prov === 'anthropic' ? user?.anthropic_api_key
    : prov === 'weavehub' ? user?.weavehub_ai_key
    : user?.openai_api_key;
  if (encrypted) {
    try {
      return await decryptValue(encrypted, env.JWT_SECRET, userId);
    } catch {
      // Fall through to worker-level secret if user's stored key cannot be decrypted.
    }
  }
  if (prov === 'weavehub') {
    // Worker-level fallback: an instance-wide wh_ai_ key stored in CLAUDE_API_KEY.
    return env.CLAUDE_API_KEY?.startsWith('wh_ai_') ? env.CLAUDE_API_KEY : null;
  }
  const envKey = prov === 'anthropic' ? env.CLAUDE_API_KEY : env.OPENAI_API_KEY;
  return envKey && envKey.length > 0 ? envKey : null;
}

// Strip HTML to plain text for the email/text-analysis path. Mirrors the logic in
// email-handler.ts so an HTML body stored in R2 (no inline attachment) still extracts
// the same way the inbound handler would have produced from the original raw email.
function htmlToText(html: string): string {
  let body = html;
  body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<[^>]+>/g, ' ');
  body = body.replace(/&nbsp;/g, ' ');
  body = body.replace(/&amp;/g, '&');
  body = body.replace(/&lt;/g, '<');
  body = body.replace(/&gt;/g, '>');
  body = body.replace(/\s+/g, ' ').trim();
  return body.slice(0, 10000);
}

/** The full processing pipeline. With `step` it runs under Workflow
    durability; without it (platform mode — dispatch-namespace workers have no
    Workflow bindings) the same code runs inline. */
export async function runReceiptPipeline(env: Env, payload: ReceiptWorkflowParams, step?: WorkflowStep) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const doStep = (name: string, a: unknown, b?: unknown): Promise<any> =>
    step
      ? (b === undefined ? (step as any).do(name, a) : (step as any).do(name, a, b))
      : Promise.resolve().then(() => (b === undefined ? (a as any)() : (b as any)()));
  {
    const { receiptId, bookId, userId, imageKey, emailBody, emailSubject, emailFrom } = payload;

    // Step 1: Mark as processing. Intentionally does NOT return the API keys —
    // step.do return values are persisted in workflow state and would expose secrets.
    await doStep('mark-processing', async () => {
      await env.DB.prepare(
        "UPDATE receipts SET status = 'processing', updated_at = datetime('now') WHERE id = ?"
      ).bind(receiptId).run();
    });

    // Step 2: Analyze the receipt. The user lookup, key decryption, and provider
    // fallback all happen inside this single step's closure so the plaintext keys
    // never escape into persisted workflow state.
    //
    // Retry config (LED-23): the in-step fallback already retries the secondary
    // provider on billing/auth-class errors, so CF's outer retry only needs to cover
    // genuinely transient network blips. Cap at 1 retry so permanent errors flip the
    // receipt to 'failed' in seconds instead of the default 5-minute backoff window.
    let analysis;
    let providerUsed: AiProvider = 'anthropic';
    let fallbackReason: string | null = null;
    try {
      const result = await doStep(
        'analyze-receipt',
        { retries: { limit: 1, delay: '2 seconds', backoff: 'constant' }, timeout: '90 seconds' },
        async () => {
          const user = await env.DB.prepare(
            'SELECT ai_provider, weavehub_ai_enabled, anthropic_api_key, openai_api_key, weavehub_ai_key FROM users WHERE id = ?'
          ).bind(userId).first<{ ai_provider: AiProvider; weavehub_ai_enabled: number; anthropic_api_key: string | null; openai_api_key: string | null; weavehub_ai_key: string | null }>();

          const primary: AiProvider = user?.weavehub_ai_enabled ? 'weavehub' : ((user?.ai_provider || 'anthropic') as AiProvider);
          // Fallback chain: weavehub → anthropic → openai; the BYO providers
          // fall back to each other. Only providers with a usable key take part.
          const fallbackOrder: AiProvider[] = primary === 'weavehub' ? ['anthropic', 'openai']
            : primary === 'anthropic' ? ['openai'] : ['anthropic'];
          const primaryKey = await resolveKey(primary, userId, user, env);
          const fallbacks: { provider: AiProvider; key: string }[] = [];
          for (const provider of fallbackOrder) {
            const key = await resolveKey(provider, userId, user, env);
            if (key) fallbacks.push({ provider, key });
          }

          if (!primaryKey) {
            throw new Error(`No API key configured for ${primary}`);
          }

          // Resolve the input once so we don't re-fetch R2 on fallback.
          //
          // LED-22: when imageKey points to an HTML body (email-source receipts that
          // had no file attachments), we cannot ship HTML to a vision API — both
          // Anthropic and OpenAI reject it as an invalid MIME type. Detect HTML by
          // extension or R2 content-type and route through the email/text path.
          // Prefer the already-extracted emailBody when available; otherwise pull the
          // HTML from R2 and strip tags inline.
          type Input =
            | { kind: 'image'; data: ArrayBuffer; contentType: string }
            | { kind: 'pdf'; data: ArrayBuffer }
            | { kind: 'email'; body: string; subject: string; from: string };

          let input: Input;
          if (imageKey) {
            const object = await env.RECEIPTS_BUCKET.get(imageKey);
            if (!object) throw new Error('Image not found in R2');
            const contentType = object.httpMetadata?.contentType || 'image/jpeg';
            const isHtml = /\.html?$/i.test(imageKey) || /^text\/html/i.test(contentType);

            if (isHtml) {
              const text = emailBody && emailBody.trim().length > 0
                ? emailBody
                : htmlToText(await object.text());
              input = { kind: 'email', body: text, subject: emailSubject || '', from: emailFrom || '' };
            } else if (contentType === 'application/pdf' || imageKey.endsWith('.pdf')) {
              input = { kind: 'pdf', data: await object.arrayBuffer() };
            } else {
              input = { kind: 'image', data: await object.arrayBuffer(), contentType };
            }
          } else if (emailBody) {
            input = { kind: 'email', body: emailBody, subject: emailSubject || '', from: emailFrom || '' };
          } else {
            throw new Error('No image or email body provided');
          }

          setAnthropicBaseUrl(env.ANTHROPIC_BASE_URL);
          setAnthropicModel(env.ANTHROPIC_MODEL);
          const runOnce = async (prov: AiProvider, key: string) => {
            if (input.kind === 'pdf') return analyzeReceiptPdf(input.data, key, prov);
            if (input.kind === 'image') return analyzeReceiptImage(input.data, input.contentType, key, prov);
            return analyzeReceiptEmail(input.body, input.subject, input.from, key, prov);
          };

          return runWithFallback({ provider: primary, key: primaryKey }, fallbacks, runOnce);
        }
      );

      analysis = result.analysis;
      providerUsed = result.providerUsed;
      fallbackReason = result.fallbackReason;
    } catch (err) {
      // LED-24: write the failed status directly rather than via step.do. A previous
      // production instance reported step.do('mark-failed') as ✅ Success while the
      // wrapped UPDATE never took effect, leaving the receipt at 'processing' until
      // manual cleanup. The operation is a single idempotent UPDATE that doesn't
      // need workflow durability — and the cleanupStuckReceipts cron is the safety
      // net if the worker dies before this returns.
      const message = err instanceof Error ? err.message : 'Unknown error';

      // Both providers failed for a credit/quota-exhaustion reason: this is
      // temporary and self-correcting (H2's cron sweep retries it once credits
      // return), so it must not look like — or be miscounted as — a genuine
      // failure. notes stays a short human-readable line (it is user-facing);
      // the raw provider messages go to ai_error_detail for diagnosis only.
      const bothFailed = parseBothProvidersFailed(message);
      if (bothFailed && classifyBothProvidersFailed(bothFailed.primaryMsg, bothFailed.secondaryMsg) === 'awaiting_credits') {
        const detail = `Primary (${bothFailed.primary}): ${bothFailed.primaryMsg} | Fallback (${bothFailed.secondary}): ${bothFailed.secondaryMsg}`;
        await env.DB.prepare(
          `UPDATE receipts SET status = 'awaiting_credits',
             notes = CASE WHEN notes IS NULL OR notes = 'Waiting for AI credits' THEN 'Waiting for AI credits' ELSE notes END,
             ai_error_detail = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).bind(detail.slice(0, 2000), receiptId).run();
        await markAllProvidersOutOfCredits(env, userId);
        return { receiptId, status: 'awaiting_credits' };
      }

      // Sole-provider path (owner directive 2026-08-16, widened rule): only one
      // provider was ever attempted (no fallback key configured, or the primary error
      // wasn't billing/auth-shaped). Same 'awaiting_credits' vs 'failed' invariant as
      // the both-providers branch, just evaluated against the one message we have.
      const singleFailed = !bothFailed ? parseSingleProviderFailed(message) : null;
      if (singleFailed && classifySingleProviderFailed(singleFailed.message) === 'awaiting_credits') {
        const detail = `${singleFailed.provider}: ${singleFailed.message}`;
        await env.DB.prepare(
          `UPDATE receipts SET status = 'awaiting_credits',
             notes = CASE WHEN notes IS NULL OR notes = 'Waiting for AI credits' THEN 'Waiting for AI credits' ELSE notes END,
             ai_error_detail = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).bind(detail.slice(0, 2000), receiptId).run();
        await markAllProvidersOutOfCredits(env, userId);
        return { receiptId, status: 'awaiting_credits' };
      }

      const diagnostic = bothFailed
        ? `Primary (${bothFailed.primary}): ${bothFailed.primaryMsg} | Fallback (${bothFailed.secondary}): ${bothFailed.secondaryMsg}`
        : singleFailed
        ? `${singleFailed.provider}: ${singleFailed.message}`
        : message;
      await env.DB.prepare(
        "UPDATE receipts SET status = 'failed', notes = ?, ai_error_detail = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(`Analysis failed: ${diagnostic.slice(0, 500)}`, diagnostic.slice(0, 2000), receiptId).run();
      return { receiptId, status: 'failed' };
    }

    // Step 3: Check for duplicates by receipt/invoice number
    const duplicate = await doStep('check-duplicates', async () => {
      if (!analysis.receipt_number && !analysis.invoice_number) return null;

      const conditions: string[] = [];
      const params: string[] = [bookId, receiptId];

      if (analysis.receipt_number) {
        conditions.push('receipt_number = ?');
        params.push(analysis.receipt_number);
      }
      if (analysis.invoice_number) {
        conditions.push('invoice_number = ?');
        params.push(analysis.invoice_number);
      }

      const existing = await env.DB.prepare(
        `SELECT id, merchant, receipt_number, invoice_number FROM receipts
         WHERE book_id = ? AND id != ? AND (${conditions.join(' OR ')})`
      ).bind(...params).first<{ id: string; merchant: string; receipt_number: string; invoice_number: string }>();

      return existing || null;
    });

    // Step 4: Save analysis results
    await doStep('save-results', async () => {
      const duplicateNote = duplicate
        ? `Possible duplicate of receipt ${duplicate.id} (${duplicate.merchant || 'unknown merchant'})`
        : null;
      // Which provider handled it is an operational detail, not something for the
      // user's Notes field (it shows in the receipt and in exports, and writing it
      // there replaced whatever the user had typed). It goes to the log only.
      if (fallbackReason) {
        console.warn(`[Receipt] ${receiptId} processed via ${providerUsed} fallback (primary error: ${fallbackReason})`);
      }
      // Drives the "credits used up" notice in Settings: stamped once when the
      // primary provider is out of credits and a fallback is carrying the scans,
      // cleared as soon as the primary works again.
      if (fallbackReason && isCreditExhaustionError(fallbackReason)) {
        await env.DB.prepare(
          "UPDATE users SET ai_fallback_since = COALESCE(ai_fallback_since, datetime('now')), ai_fallback_provider = ? WHERE id = ?"
        ).bind(providerUsed, userId).run();
      } else if (!fallbackReason) {
        await env.DB.prepare(
          'UPDATE users SET ai_fallback_since = NULL, ai_fallback_provider = NULL WHERE id = ? AND ai_fallback_since IS NOT NULL'
        ).bind(userId).run();
      }
      const combinedNote = duplicateNote;

      const statements = [
        env.DB.prepare(
          `UPDATE receipts SET
            merchant = ?, amount = ?, currency = ?, date = ?, category = ?,
            subcategory = ?, description = ?, payment_method = ?,
            tax_amount = ?, tip_amount = ?, ai_confidence = ?,
            receipt_number = ?, invoice_number = ?,
            tax_deductible = ?, tax_category = ?,
            notes = CASE
                      WHEN ? IS NOT NULL THEN ?
                      -- Clear the pipeline's own awaiting_credits sentinel on the way
                      -- OUT, or a receipt that recovers (H2's sweep, or a manual retry)
                      -- completes with a real merchant and amount while still reading
                      -- "Waiting for AI credits" — in the detail view AND in export.ts's
                      -- CSV Notes column, i.e. the user's accounting record. Matched
                      -- exactly, NOT blanket-nulled: the CASE exists so a user-authored
                      -- note survives completion, and that must stay true.
                      WHEN notes = 'Waiting for AI credits' THEN NULL
                      ELSE notes
                    END,
            status = 'completed', ai_error_detail = NULL, updated_at = datetime('now')
           WHERE id = ?`
        ).bind(
          analysis.merchant, analysis.amount, analysis.currency, analysis.date,
          analysis.category, analysis.subcategory, analysis.description,
          analysis.payment_method, analysis.tax_amount, analysis.tip_amount,
          analysis.confidence, analysis.receipt_number, analysis.invoice_number,
          analysis.tax_deductible ? 1 : 0, analysis.tax_category,
          combinedNote, combinedNote, receiptId
        ),
      ];

      if (analysis.line_items && analysis.line_items.length > 0) {
        for (const item of analysis.line_items) {
          const itemId = generateId('li');
          statements.push(
            env.DB.prepare(
              'INSERT INTO line_items (id, receipt_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(itemId, receiptId, item.description, item.quantity, item.unit_price, item.total)
          );
        }
      }

      await env.DB.batch(statements);
    });

    return {
      receiptId,
      status: 'completed',
      providerUsed,
      fellBack: fallbackReason !== null,
      analysis,
      duplicate: duplicate ? { id: duplicate.id, merchant: duplicate.merchant } : null,
    };
  }
}

export class ReceiptProcessorWorkflow extends WorkflowEntrypoint<Env, ReceiptWorkflowParams> {
  async run(event: WorkflowEvent<ReceiptWorkflowParams>, step: WorkflowStep) {
    return runReceiptPipeline(this.env, event.payload, step);
  }
}

/** Start receipt processing on whichever engine this deployment has: the
    durable Workflow when bound, otherwise inline in the background. The
    caller's existing catch/fallback semantics are preserved: a thrown error
    here means "could not start". */
export async function startReceiptProcessing(
  env: Env,
  workflowId: string,
  params: ReceiptWorkflowParams,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<void> {
  if (env.RECEIPT_WORKFLOW) {
    await env.RECEIPT_WORKFLOW.create({ id: workflowId, params });
    return;
  }
  const run = runReceiptPipeline(env, params).catch(async () => {
    // Terminal writes happen inside the pipeline; this catch only guards
    // against failures thrown before those writes. Best-effort mark.
    await env.DB.prepare(
      "UPDATE receipts SET status = 'failed', notes = 'Processing crashed before completion', updated_at = datetime('now') WHERE id = ? AND status IN ('pending','processing')"
    ).bind(params.receiptId).run().catch(() => {});
  });
  if (waitUntil) waitUntil(run); else await run;
}
