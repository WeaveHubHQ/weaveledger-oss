import { Env, AiProvider } from '../types';
import { analyzeReceiptImage, analyzeReceiptPdf, analyzeReceiptEmail, setAnthropicBaseUrl } from '../services/receipt-analyzer';
import { generateId, decryptValue } from '../utils/crypto';
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

interface ReceiptWorkflowParams {
  receiptId: string;
  bookId: string;
  userId: string;
  imageKey?: string;
  emailBody?: string;
  emailSubject?: string;
  emailFrom?: string;
}

// Errors where the primary provider is structurally unavailable (no credits, revoked key,
// quota exhausted, rate-limited beyond our window). For these we want to fall back to the
// secondary provider rather than retry the primary. Transient 5xx are intentionally NOT
// matched — those should retry the primary via the workflow's standard retry path.
function isBillingOrAuthError(message: string): boolean {
  if (/credit balance/i.test(message)) return true;
  if (/insufficient[_ ]quota/i.test(message)) return true;
  if (/\bbilling\b/i.test(message)) return true;
  if (/\bquota\b/i.test(message)) return true;
  if (/API error: 401\b/.test(message)) return true;
  if (/API error: 403\b/.test(message)) return true;
  if (/API error: 429\b/.test(message)) return true;
  return false;
}

// User keys are encrypted with userId as the per-user salt context (see routes/auth.ts).
// decryptValue must be called with the same context or it silently fails.
async function resolveKey(
  prov: AiProvider,
  userId: string,
  user: { anthropic_api_key: string | null; openai_api_key: string | null } | null,
  env: Env,
): Promise<string | null> {
  const encrypted = prov === 'anthropic' ? user?.anthropic_api_key : user?.openai_api_key;
  if (encrypted) {
    try {
      return await decryptValue(encrypted, env.JWT_SECRET, userId);
    } catch {
      // Fall through to worker-level secret if user's stored key cannot be decrypted.
    }
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

export class ReceiptProcessorWorkflow extends WorkflowEntrypoint<Env, ReceiptWorkflowParams> {
  async run(event: WorkflowEvent<ReceiptWorkflowParams>, step: WorkflowStep) {
    const { receiptId, bookId, userId, imageKey, emailBody, emailSubject, emailFrom } = event.payload;

    // Step 1: Mark as processing. Intentionally does NOT return the API keys —
    // step.do return values are persisted in workflow state and would expose secrets.
    await step.do('mark-processing', async () => {
      await this.env.DB.prepare(
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
      const result = await step.do(
        'analyze-receipt',
        { retries: { limit: 1, delay: '2 seconds', backoff: 'constant' }, timeout: '90 seconds' },
        async () => {
          const user = await this.env.DB.prepare(
            'SELECT ai_provider, anthropic_api_key, openai_api_key FROM users WHERE id = ?'
          ).bind(userId).first<{ ai_provider: AiProvider; anthropic_api_key: string | null; openai_api_key: string | null }>();

          const primary = (user?.ai_provider || 'anthropic') as AiProvider;
          const secondary: AiProvider = primary === 'anthropic' ? 'openai' : 'anthropic';
          const primaryKey = await resolveKey(primary, userId, user, this.env);
          const secondaryKey = await resolveKey(secondary, userId, user, this.env);

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
            const object = await this.env.RECEIPTS_BUCKET.get(imageKey);
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

          setAnthropicBaseUrl(this.env.ANTHROPIC_BASE_URL);
          const runOnce = async (prov: AiProvider, key: string) => {
            if (input.kind === 'pdf') return analyzeReceiptPdf(input.data, key, prov);
            if (input.kind === 'image') return analyzeReceiptImage(input.data, input.contentType, key, prov);
            return analyzeReceiptEmail(input.body, input.subject, input.from, key, prov);
          };

          try {
            const a = await runOnce(primary, primaryKey);
            return { analysis: a, providerUsed: primary, fallbackReason: null as string | null };
          } catch (primaryErr) {
            const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
            if (!secondaryKey || !isBillingOrAuthError(primaryMsg)) {
              throw primaryErr;
            }
            try {
              const a = await runOnce(secondary, secondaryKey);
              return { analysis: a, providerUsed: secondary, fallbackReason: primaryMsg.slice(0, 200) };
            } catch (secondaryErr) {
              const secondaryMsg = secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr);
              throw new Error(
                `Both providers failed. Primary (${primary}): ${primaryMsg.slice(0, 200)} | Fallback (${secondary}): ${secondaryMsg.slice(0, 200)}`
              );
            }
          }
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
      await this.env.DB.prepare(
        "UPDATE receipts SET status = 'failed', notes = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(`Analysis failed: ${message.slice(0, 500)}`, receiptId).run();
      return { receiptId, status: 'failed' };
    }

    // Step 3: Check for duplicates by receipt/invoice number
    const duplicate = await step.do('check-duplicates', async () => {
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

      const existing = await this.env.DB.prepare(
        `SELECT id, merchant, receipt_number, invoice_number FROM receipts
         WHERE book_id = ? AND id != ? AND (${conditions.join(' OR ')})`
      ).bind(...params).first<{ id: string; merchant: string; receipt_number: string; invoice_number: string }>();

      return existing || null;
    });

    // Step 4: Save analysis results
    await step.do('save-results', async () => {
      const duplicateNote = duplicate
        ? `Possible duplicate of receipt ${duplicate.id} (${duplicate.merchant || 'unknown merchant'})`
        : null;
      const fallbackNote = fallbackReason
        ? `Processed via ${providerUsed} fallback (primary error: ${fallbackReason})`
        : null;
      const combinedNote = [duplicateNote, fallbackNote].filter(Boolean).join('\n') || null;

      const statements = [
        this.env.DB.prepare(
          `UPDATE receipts SET
            merchant = ?, amount = ?, currency = ?, date = ?, category = ?,
            subcategory = ?, description = ?, payment_method = ?,
            tax_amount = ?, tip_amount = ?, ai_confidence = ?,
            receipt_number = ?, invoice_number = ?,
            tax_deductible = ?, tax_category = ?,
            notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
            status = 'completed', updated_at = datetime('now')
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
            this.env.DB.prepare(
              'INSERT INTO line_items (id, receipt_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(itemId, receiptId, item.description, item.quantity, item.unit_price, item.total)
          );
        }
      }

      await this.env.DB.batch(statements);
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
