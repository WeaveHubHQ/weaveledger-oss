import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { convertToUsdCents } from '../utils/fx';
import { reconcileAllUsers } from '../services/reconciliation';

/**
 * LED-39 — admin/observability endpoints. All require an authenticated user
 * (routed via the existing auth middleware). They are global operations,
 * not user-scoped, but the auth requirement keeps them off the public
 * internet. We can add a role check later if non-admin users get accounts.
 */

/**
 * POST /api/admin/reconcile?as_of=YYYY-MM-DD
 *
 * Runs the same code path as the monthly cron. Use to backfill prior
 * months or to manually re-trigger after a cron failure.
 */
export async function triggerReconcile(request: Request, env: Env, _userId: string): Promise<Response> {
  const url = new URL(request.url);
  const asOfParam = url.searchParams.get('as_of');
  const asOf = asOfParam ? new Date(`${asOfParam}T00:00:00Z`) : new Date();
  if (isNaN(asOf.getTime())) return error('Invalid as_of date (YYYY-MM-DD required)', 400);

  const runId = generateId('cron');
  const startedAt = new Date();
  await env.DB.prepare(
    `INSERT INTO cron_runs (id, cron_name, cron_schedule, trigger, started_at, status, metadata)
     VALUES (?, 'reconcile_all_users', '0 7 1 * *', 'manual', ?, 'running', ?)`
  ).bind(runId, startedAt.toISOString(), JSON.stringify({ as_of: asOf.toISOString() })).run();

  try {
    const summary = await reconcileAllUsers(env, asOf);
    const finishedAt = new Date();
    await env.DB.prepare(
      `UPDATE cron_runs
       SET finished_at = ?, duration_ms = ?, status = 'success',
           rows_settled = ?, payouts_created = ?, users_processed = ?
       WHERE id = ?`
    ).bind(
      finishedAt.toISOString(),
      finishedAt.getTime() - startedAt.getTime(),
      summary.rowsSettled, summary.payoutsCreated, summary.usersProcessed,
      runId,
    ).run();
    return success({ run_id: runId, as_of: asOf.toISOString().slice(0, 10), ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await env.DB.prepare(
      `UPDATE cron_runs
       SET finished_at = datetime('now'),
           duration_ms = ?, status = 'error', error_message = ?
       WHERE id = ?`
    ).bind(Date.now() - startedAt.getTime(), msg.slice(0, 1000), runId).run();
    return error(`Reconcile failed: ${msg}`, 500);
  }
}

/**
 * POST /api/admin/backfill-usd
 *
 * Find income_transactions with usd_amount_cents IS NULL and fill them
 * via the FX helper using the transaction's own date. Bounded to 500 rows
 * per call so we don't hit CPU limits; re-run until response says
 * remaining: 0.
 */
export async function backfillUsd(_request: Request, env: Env, userId: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, amount, currency, transaction_date
     FROM income_transactions
     WHERE user_id = ? AND usd_amount_cents IS NULL AND amount != 0
     ORDER BY transaction_date DESC
     LIMIT 500`
  ).bind(userId).all<{ id: string; amount: number; currency: string; transaction_date: string }>();

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows.results) {
    try {
      const usd = await convertToUsdCents(env, row.amount, row.currency, row.transaction_date);
      if (!usd) { skipped++; continue; }
      await env.DB.prepare(
        `UPDATE income_transactions
         SET usd_amount_cents = ?, fx_rate = ?, fx_rate_date = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(usd.usdCents, usd.rate, usd.rateDate, row.id).run();
      updated++;
    } catch (e) {
      errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM income_transactions
     WHERE user_id = ? AND usd_amount_cents IS NULL AND amount != 0`
  ).bind(userId).first<{ n: number }>();

  return success({
    updated,
    skipped,
    remaining: remaining?.n ?? 0,
    errors: errors.slice(0, 10),
  });
}

/**
 * GET /api/admin/cron-runs?limit=20
 *
 * Recent cron run audit log. Use to confirm the monthly reconcile actually
 * fired (and what it did) without grepping wrangler tail.
 */
export async function listCronRuns(request: Request, env: Env, _userId: string): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20') || 20, 200);
  const results = await env.DB.prepare(
    `SELECT id, cron_name, cron_schedule, trigger, started_at, finished_at,
            duration_ms, status, rows_settled, payouts_created, users_processed,
            error_message, metadata
     FROM cron_runs
     ORDER BY started_at DESC LIMIT ?`
  ).bind(limit).all();
  return success(results.results);
}
