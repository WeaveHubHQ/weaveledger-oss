import { Env } from '../types';

/**
 * Daily extraction-failure alert.
 *
 * Motivation: 28 receipts failed silently for six weeks after Anthropic retired
 * a pinned model id. The extraction bug was fixable in minutes; the reason it
 * lasted six weeks is that nothing ever said so. A failed receipt is invisible
 * unless the owner happens to scroll the Expenses list, so this reports them.
 *
 * Sends at most one email per day, to each owner who had receipts fail in the
 * window, and stays quiet when there is nothing to report.
 *
 * Task H4: `awaiting_credits` receipts (H1) get their own sentence, separate
 * from genuine `failed` receipts, so the actionable case doesn't get buried in
 * the generic one. That status does NOT reliably mean "out of credits" — a
 * bare rate-limit (`API error: 429`) lands there too, by design (see
 * `workflows/credit-classification.ts`) — so the copy below stays true for
 * both causes and never asserts a specific one. H2's cron sweep already
 * retries these automatically, so the copy tells the user there is nothing to
 * do, instead of the old (now wrong) "use Retry failed" instruction.
 *
 * Neither sentence quotes `notes`/`ai_error_detail` verbatim: those fields can
 * carry raw provider text, including raw JSON error bodies straight from the
 * AI gateway. A previous version of this email leaked that JSON into the
 * message body sent to a real user — see CHANGELOG for the incident this fixes.
 *
 * Window column choice (H4 review fix): `failed` rows are windowed on
 * `updated_at`, but `awaiting_credits` rows are windowed on `created_at`.
 * This is deliberate, not an inconsistency. H2's cron sweep touches every
 * parked receipt on every run (10-minute cadence) and bumps `updated_at`
 * whether or not the retry succeeds, so an `updated_at` window would never
 * let a still-exhausted receipt age out — the same "no action is needed"
 * email would repeat every single day, indefinitely, which is exactly the
 * alert-fatigue failure mode this task exists to avoid. `created_at` isn't
 * touched by the sweep, so it doesn't have that problem. It is not an exact
 * "first parked" timestamp — `startReceiptProcessing` is kicked off from the
 * same `createReceipt` call that sets `created_at`, so in practice the two
 * are seconds apart, but a receipt that sat unprocessed for days before its
 * first credit-exhaustion classification would be under-windowed by this
 * choice (it could go straight from "too new" to "already aged out" without
 * ever appearing in an email). That gap is accepted here rather than adding
 * a dedicated `first_parked_at` column, which is a schema migration outside
 * this task's scope — if it becomes a real problem, that column is the
 * cleaner fix. A `failed` row keeps windowing on `updated_at` because that
 * column IS a meaningful signal there: nothing re-touches a genuinely failed
 * receipt, so it goes stale and correctly drops out of the window once fixed
 * or manually retried.
 */

const WINDOW_HOURS = 24;

interface FailureRow {
  user_id: string;
  email: string;
  failed_n: number;
  waiting_n: number;
}

export async function alertOnRecentFailures(env: Env): Promise<{ notified: number; failures: number; waiting: number }> {
  // `failed` is windowed on updated_at (it goes stale once fixed/retried);
  // `awaiting_credits` is windowed on created_at (H2's sweep re-touches
  // updated_at on every parked receipt, so that column never goes stale for
  // this status — see the header comment for why that would make the
  // waiting-only email recur forever).
  const windowArg = `-${WINDOW_HOURS} hours`;
  const rows = await env.DB.prepare(
    `SELECT r.user_id, u.email,
            SUM(CASE WHEN r.status = 'failed' AND r.updated_at > datetime('now', ?) THEN 1 ELSE 0 END) AS failed_n,
            SUM(CASE WHEN r.status = 'awaiting_credits' AND r.created_at > datetime('now', ?) THEN 1 ELSE 0 END) AS waiting_n
       FROM receipts r
       JOIN users u ON u.id = r.user_id
      WHERE (r.status = 'failed' AND r.updated_at > datetime('now', ?))
         OR (r.status = 'awaiting_credits' AND r.created_at > datetime('now', ?))
      GROUP BY r.user_id, u.email`
  ).bind(windowArg, windowArg, windowArg, windowArg).all<FailureRow>();

  if (!rows.results.length) return { notified: 0, failures: 0, waiting: 0 };

  let notified = 0;
  let failures = 0;
  let waiting = 0;
  for (const row of rows.results) {
    // A user with only awaiting_credits rows and zero failed rows still needs
    // an email (that's the whole point of H4) — only skip a row with neither,
    // which the WHERE/GROUP BY above shouldn't produce, but stay defensive.
    if (row.failed_n <= 0 && row.waiting_n <= 0) continue;
    failures += row.failed_n;
    waiting += row.waiting_n;
    try {
      await sendFailureEmail(env, row);
      notified++;
    } catch (e) {
      // Never let a mail problem break the cron; the log is the fallback signal.
      console.error('[failure-alert] could not notify', row.email, e);
    }
  }
  return { notified, failures, waiting };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Builds the subject line, covering the three non-empty combinations. */
function buildSubject(row: Pick<FailureRow, 'failed_n' | 'waiting_n'>): string {
  const hasFailed = row.failed_n > 0;
  const hasWaiting = row.waiting_n > 0;
  if (hasFailed && hasWaiting) {
    return `${plural(row.failed_n, 'receipt')} could not be processed, ${plural(row.waiting_n, 'receipt')} waiting on the AI provider`;
  }
  if (hasFailed) {
    return `${plural(row.failed_n, 'receipt')} could not be processed`;
  }
  return `${plural(row.waiting_n, 'receipt')} waiting on the AI provider`;
}

export interface RenderedFailureEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Pure rendering of the email body from the two counts — no D1, no network.
 * Exported so it can be unit-asserted directly (see
 * `api/scripts/verify-failure-alert-copy.ts`) instead of only exercised
 * end-to-end through a live send.
 *
 * Deliberately never references `notes`/`ai_error_detail`: those fields can
 * carry raw provider error bodies (including raw JSON), which are for
 * diagnosis, not for a user-facing email.
 */
export function renderFailureEmail(row: Pick<FailureRow, 'failed_n' | 'waiting_n'>): RenderedFailureEmail {
  const subject = buildSubject(row);

  const failedLine = row.failed_n > 0
    ? `${plural(row.failed_n, 'receipt')} failed to process in the last ${WINDOW_HOURS} hours. The original files are still stored, so nothing is lost — open the Expenses page, choose the affected book, and use "Retry failed" once you've resolved the cause. (The specific error is on each receipt's detail page, under Notes.)`
    : null;

  const waitingLine = row.waiting_n > 0
    ? (() => {
        const isSingular = row.waiting_n === 1;
        const be = isSingular ? 'is' : 'are';
        const pronoun = isSingular ? 'it' : 'they';
        return `${plural(row.waiting_n, 'receipt')} in the last ${WINDOW_HOURS} hours ${be} waiting on the AI provider. This is temporary — ${pronoun} will retry automatically, and no action is needed. If this continues for a while, it may help to top up AI credits at weavehub.app/ai.`;
      })()
    : null;

  const textLines = [failedLine, waitingLine].filter((l): l is string => l !== null);
  const text = textLines.join('\n\n');

  const htmlParagraphs = [
    failedLine
      ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.5">${escapeHtml(failedLine)}</p>`
      : '',
    waitingLine
      ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.5">${escapeHtml(waitingLine)}</p>`
      : '',
  ].filter(Boolean).join('');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0A1628">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F0E8;padding:40px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;border:1px solid #E8E0D0">
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 12px;font-size:19px">${escapeHtml(subject)}</h1>
        ${htmlParagraphs}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  return { subject, text, html };
}

async function sendFailureEmail(env: Env, row: FailureRow): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM || 'noreply@weaveledger.app';
  const { subject, text, html } = renderFailureEmail(row);

  if (apiKey) {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `WeaveLedger <${from}>`, to: [row.email], subject, html, text }),
    });
    if (!resp.ok) throw new Error(`Resend ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    return;
  }
  if (env.SEND_EMAIL) {
    await env.SEND_EMAIL.send({ to: row.email, from: `WeaveLedger <${from}>`, subject, html, text });
    return;
  }
  throw new Error('no outbound email configured');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
