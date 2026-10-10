import { Env } from '../types';
import { startReceiptProcessing } from '../workflows/receipt-processor';

/**
 * Phase H2 — cron sweep for receipts parked in `awaiting_credits`.
 *
 * H1 (api/src/workflows/receipt-processor.ts) parks a receipt in
 * `awaiting_credits` instead of `failed` when every AI provider actually
 * attempted failed on a credit/quota-exhaustion error (or a bare rate-limit
 * `API error: 429` — also transient, also wants park-and-retry). That
 * condition is self-correcting once the user tops up or the rate window
 * clears, so this sweep periodically requeues those receipts through the
 * existing pipeline rather than leaving them stuck until a manual retry.
 *
 * There is no cheap, reliable "does this tenant have credit again?" probe —
 * checking would mean calling the same provider API that's failing, which
 * is exactly the request we're trying not to make speculatively. So per the
 * task brief, this simply re-attempts processing and lets the pipeline's
 * own classifier (`classifyBothProvidersFailed` / `classifySingleProviderFailed`
 * in credit-classification.ts) sort the outcome: completed, back to
 * `awaiting_credits` if still out of credit, or `failed` if the retry surfaced
 * a genuine (non-credit) error.
 *
 * Capped per run (default 25) so a large backlog drains over several
 * 10-minute ticks instead of stampeding the gateway the instant credits
 * return. Oldest-parked-first (`ORDER BY updated_at ASC`) so no receipt is
 * starved behind a constant stream of newly-parked ones.
 *
 * Idempotent / safe to run twice in the same window: the row is flipped out
 * of `awaiting_credits` (`WHERE status = 'awaiting_credits'`) in the same
 * UPDATE that decides whether to requeue it, so a second sweep running
 * concurrently or immediately after simply finds nothing left to pick up —
 * no double-requeue, no duplicate workflow rows.
 *
 * Deliberately does NOT touch `notes`. H1's completion path clears the
 * `'Waiting for AI credits'` sentinel by exact match specifically so a
 * user-authored note survives — that CASE lives in receipt-processor.ts and
 * fires again whether this sweep's retry succeeds or fails. Blanket-clearing
 * `notes` here (the way the failed-only `retryReceipt` endpoint does) would
 * destroy a user's own annotation on a receipt they may have been watching
 * while it waited.
 *
 * If `startReceiptProcessing` throws, its only throw path is
 * `env.RECEIPT_WORKFLOW.create(...)` itself failing (e.g. a Workflows
 * concurrency/rate limit — plausible exactly when a burst of receipts get
 * requeued the instant credits return). When that happens NOTHING is
 * running for that receipt: the non-workflow fallback branch attaches
 * `.catch` internally and cannot reject through to here. So the row is
 * parked back to `awaiting_credits` (not left at `pending`/`processing`,
 * which `cleanupStuckReceipts` would mark `failed` ~15 minutes later,
 * permanently outside this sweep's `WHERE status = 'awaiting_credits'`
 * selection) and NOT counted in `requeued`, so the next tick retries it.
 * This is bounded by the same 25-cap that already bounds "still out of
 * credits".
 */

const DEFAULT_CAP = 25;

export interface CreditRetryResult {
  checked: number;
  requeued: number;
}

interface AwaitingCreditsRow {
  id: string;
  book_id: string;
  user_id: string;
  image_key: string | null;
  raw_email: string | null;
}

export async function retryAwaitingCredits(env: Env, cap: number = DEFAULT_CAP): Promise<CreditRetryResult> {
  const rows = await env.DB.prepare(
    `SELECT id, book_id, user_id, image_key, raw_email
     FROM receipts
     WHERE status = 'awaiting_credits'
     ORDER BY updated_at ASC
     LIMIT ?`
  ).bind(cap).all<AwaitingCreditsRow>();

  const candidates = rows.results ?? [];
  let requeued = 0;

  for (const r of candidates) {
    // Flip out of awaiting_credits and back to pending atomically, guarded by
    // status so a receipt already moved by a concurrent/duplicate sweep run
    // is skipped rather than requeued twice. Notes are untouched on purpose
    // (see module doc comment). ai_error_detail IS cleared — it's the raw
    // provider text from the run that parked this receipt, and leaving it in
    // place would let a `pending`-status row read stale diagnostic text from
    // a previous attempt mid-flight.
    const flip = await env.DB.prepare(
      "UPDATE receipts SET status = 'pending', ai_error_detail = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'awaiting_credits'"
    ).bind(r.id).run();

    if (!flip.meta || flip.meta.changes === 0) {
      // Already moved by another pass in this window (or between our SELECT
      // and this UPDATE) — not an error, just nothing left to do here.
      continue;
    }

    try {
      await startReceiptProcessing(env, r.id + '_creditsweep_' + Date.now(), {
        receiptId: r.id,
        bookId: r.book_id,
        userId: r.user_id,
        imageKey: r.image_key || undefined,
        emailBody: r.raw_email || undefined,
      });
      requeued++;
    } catch (err) {
      // startReceiptProcessing's only throw path is RECEIPT_WORKFLOW.create
      // itself failing — nothing is running for this receipt. Unlike the
      // user-initiated retryReceipt/retryAllFailedReceipts endpoints (a
      // human sees the failure and can click again), this sweep is
      // unattended, so silently leaving the row at 'pending' would let
      // cleanupStuckReceipts mark it 'failed' ~15 minutes later — permanently
      // outside this sweep's `status = 'awaiting_credits'` selection. Park it
      // back to awaiting_credits instead so the next tick retries it, and do
      // NOT count it as requeued.
      const reason = err instanceof Error ? err.message : 'unknown error';
      // Carry the reason on the row itself. The flip above cleared
      // ai_error_detail, so without this a receipt whose create() fails every
      // tick cycles awaiting_credits -> pending -> awaiting_credits forever
      // while looking *identical* to a healthy park, in the UI and in the DB.
      // Looping is the right default (awaiting_credits is an indefinite park
      // by design, and the flip bumps updated_at so the row sorts to the back
      // and cannot starve others) — but it must not be invisible.
      const parked = await env.DB.prepare(
        "UPDATE receipts SET status = 'awaiting_credits', ai_error_detail = ? WHERE id = ? AND status = 'pending'"
      ).bind(`requeue failed: ${reason}`.slice(0, 2000), r.id).run().catch(() => null);
      // Branch the log on what actually happened. Emitting the success message
      // unconditionally meant that in the one case where recovery FAILED, the
      // only diagnostic in the system asserted the opposite: the row stays
      // 'pending', cleanupStuckReceipts marks it 'failed' ~15 min later, and
      // it leaves this sweep's selection for good.
      if (parked?.meta?.changes === 1) {
        console.error('[credit-retry] startReceiptProcessing threw; left parked in awaiting_credits for next tick:', reason);
      } else {
        console.error(
          '[credit-retry] STRANDED: startReceiptProcessing threw AND the park-back did not apply for',
          r.id, '- row is likely still pending and cleanupStuckReceipts will mark it failed. Original error:', reason,
        );
      }
    }
  }

  console.log(`[credit-retry] checked=${candidates.length} requeued=${requeued}`);

  return { checked: candidates.length, requeued };
}
