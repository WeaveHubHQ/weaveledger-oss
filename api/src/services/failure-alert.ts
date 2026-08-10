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
 */

const WINDOW_HOURS = 24;

interface FailureRow {
  user_id: string;
  email: string;
  n: number;
  sample_note: string | null;
}

export async function alertOnRecentFailures(env: Env): Promise<{ notified: number; failures: number }> {
  const rows = await env.DB.prepare(
    `SELECT r.user_id, u.email, COUNT(*) AS n, MAX(r.notes) AS sample_note
       FROM receipts r
       JOIN users u ON u.id = r.user_id
      WHERE r.status = 'failed'
        AND r.updated_at > datetime('now', ?)
      GROUP BY r.user_id, u.email`
  ).bind(`-${WINDOW_HOURS} hours`).all<FailureRow>();

  if (!rows.results.length) return { notified: 0, failures: 0 };

  let notified = 0;
  let failures = 0;
  for (const row of rows.results) {
    failures += row.n;
    try {
      await sendFailureEmail(env, row);
      notified++;
    } catch (e) {
      // Never let a mail problem break the cron; the log is the fallback signal.
      console.error('[failure-alert] could not notify', row.email, e);
    }
  }
  return { notified, failures };
}

async function sendFailureEmail(env: Env, row: FailureRow): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM || 'noreply@weaveledger.app';
  const plural = row.n === 1 ? 'receipt' : 'receipts';
  const subject = `${row.n} ${plural} could not be processed`;
  const reason = (row.sample_note || '').slice(0, 300);

  const text = [
    `${row.n} ${plural} failed to process in the last ${WINDOW_HOURS} hours.`,
    '',
    reason ? `Most recent reason: ${reason}` : '',
    '',
    'The original files are still stored, so nothing is lost. Open the Expenses',
    'page, choose the affected book, and use "Retry failed" once the cause is',
    'resolved.',
  ].filter(Boolean).join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0A1628">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F0E8;padding:40px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;border:1px solid #E8E0D0">
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 12px;font-size:19px">${row.n} ${plural} could not be processed</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.5">In the last ${WINDOW_HOURS} hours, ${row.n} ${plural} failed during extraction.</p>
        ${reason ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#555"><b>Most recent reason:</b><br><code style="font-family:monospace">${escapeHtml(reason)}</code></p>` : ''}
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5">The original files are still stored, so nothing is lost. Open the Expenses page, choose the affected book, and use <b>Retry failed</b> once the cause is resolved.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

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
