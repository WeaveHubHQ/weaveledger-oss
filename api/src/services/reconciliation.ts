import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { convertToUsdCents } from '../utils/fx';

/**
 * LED-34 — Monthly reconciliation.
 *
 * For each (user, source) pair, at month-start:
 *   1. Find all `status='pending'` income_transactions from the prior closed
 *      calendar month.
 *   2. Aggregate by currency.
 *   3. Convert each currency total to USD; sum to a single USD payout amount.
 *   4. Create a `payouts` row with status='predicted', period_start..end set
 *      to the prior month, predicted_date set per provider's typical payout
 *      schedule.
 *   5. Mark all those income rows as `status='settled'`, linked via payout_id.
 *
 * Idempotent — re-running the same (user, source, period) is a no-op if a
 * predicted payout already exists.
 *
 * Stripe is intentionally NOT reconciled here. Stripe has explicit payout
 * events with confirmed dates; LED-35 handles Stripe directly via its
 * payouts API.
 */

// Provider payout-timing constants. Days from period_end to predicted bank
// landing. Apple typically wires 33-45 days after fiscal-month close; we use
// 33 as the optimistic predicted date. Google Play wires around the 15th of
// the following calendar month, so ~15 days after period_end.
const PAYOUT_DELAY_DAYS: Record<string, number> = {
  apple_app_store: 33,
  google_play: 15,
};

const RECONCILED_SOURCES = ['apple_app_store', 'google_play'] as const;
type ReconciledSource = (typeof RECONCILED_SOURCES)[number];

export interface ReconcileResult {
  userId: string;
  source: string;
  periodStart: string;
  periodEnd: string;
  payoutId?: string;
  incomeRowsLinked: number;
  amountUsdCents: number;
  status: 'created' | 'already_exists' | 'no_pending_rows';
}

/**
 * Settle a single (user, source) pair for the prior calendar month relative
 * to `asOfDate`. Returns a structured result; throws only on DB errors.
 */
export async function reconcileOneSource(
  env: Env,
  userId: string,
  integrationId: string | null,
  source: ReconciledSource,
  asOfDate: Date = new Date(),
): Promise<ReconcileResult> {
  // Prior calendar month: from 1st of (asOfDate's month - 1) to 1st of
  // asOfDate's month (exclusive). Using UTC to avoid TZ drift.
  const periodEndDate = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), 1));
  const periodStartDate = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() - 1, 1));
  const periodStart = periodStartDate.toISOString().slice(0, 10);
  const periodEnd = periodEndDate.toISOString().slice(0, 10);

  // Idempotency check: do we already have a predicted/pending/paid payout
  // for this exact period? If so, leave it alone.
  const existing = await env.DB.prepare(
    `SELECT id FROM payouts
     WHERE user_id = ? AND source = ? AND period_start = ? AND period_end = ?
     LIMIT 1`
  ).bind(userId, source, periodStart, periodEnd).first<{ id: string }>();

  if (existing) {
    return {
      userId, source, periodStart, periodEnd,
      payoutId: existing.id,
      incomeRowsLinked: 0,
      amountUsdCents: 0,
      status: 'already_exists',
    };
  }

  // Find pending rows in the period.
  const pending = await env.DB.prepare(
    `SELECT id, amount, currency, usd_amount_cents, transaction_date
     FROM income_transactions
     WHERE user_id = ? AND source = ?
       AND status = 'pending'
       AND transaction_date >= ?
       AND transaction_date < ?`
  ).bind(userId, source, periodStart, periodEnd).all<{
    id: string; amount: number; currency: string;
    usd_amount_cents: number | null; transaction_date: string;
  }>();

  const rows = pending.results;
  if (rows.length === 0) {
    return {
      userId, source, periodStart, periodEnd,
      incomeRowsLinked: 0,
      amountUsdCents: 0,
      status: 'no_pending_rows',
    };
  }

  // Aggregate by currency. Sum local amounts; sum USD-converted amounts.
  // Some rows may have null usd_amount_cents (FX miss at insert time);
  // try to backfill them now using the FX helper at period_end.
  const byCurrency: Record<string, number> = {};
  let totalUsdCents = 0;

  for (const row of rows) {
    byCurrency[row.currency] = (byCurrency[row.currency] || 0) + row.amount;
    if (row.usd_amount_cents !== null && row.usd_amount_cents !== undefined) {
      totalUsdCents += row.usd_amount_cents;
    } else {
      // Backfill USD on the fly. Don't update the row — keep state pure here.
      const usd = await convertToUsdCents(env, row.amount, row.currency, periodEnd);
      if (usd) totalUsdCents += usd.usdCents;
    }
  }

  // Pick the "primary" currency for the payout row. For multi-currency
  // periods we use USD as the local currency, since the user will receive a
  // single USD wire from the provider (Apple/Google convert to the user's
  // bank currency at payout time and we don't know that currency a priori).
  //
  // LED-40: `amount_local_cents` is the source currency's minor-unit count
  // per ISO 4217 — that is ¥500 for ¥500, not 50000. For zero-decimal
  // currencies the column name is a historical misnomer but the value is
  // correct because we now write `income_transactions.amount` in true
  // minor units.
  const currencies = Object.keys(byCurrency);
  const localCurrency = currencies.length === 1 ? currencies[0] : 'USD';
  const localAmountCents = localCurrency === 'USD'
    ? totalUsdCents
    : byCurrency[localCurrency];

  // Predicted date.
  const predictedDate = new Date(periodEndDate.getTime() + PAYOUT_DELAY_DAYS[source] * 86400_000)
    .toISOString().slice(0, 10);

  // Synthesized source_payout_id so reruns and Stripe-real-payout-IDs don't
  // collide. Pattern: <source>_<period_start>_predicted.
  const sourcePayoutId = `${source}_${periodStart}_predicted`;
  const payoutId = generateId('payout');

  // Create the payout row.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO payouts
     (id, user_id, integration_id, source, source_payout_id, status,
      amount_local_cents, currency, amount_usd_cents, fx_rate,
      period_start, period_end, predicted_date, metadata)
     VALUES (?, ?, ?, ?, ?, 'predicted', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    payoutId, userId, integrationId, source, sourcePayoutId,
    localAmountCents, localCurrency, totalUsdCents, null,
    periodStart, periodEnd, predictedDate,
    JSON.stringify({
      currencies: byCurrency,
      row_count: rows.length,
      reconciled_at: new Date().toISOString(),
    })
  ).run();

  // Link the income rows.
  // D1 doesn't support array binding, so we batch-execute parameterized updates.
  const incomeIds = rows.map((r) => r.id);
  const placeholders = incomeIds.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE income_transactions
     SET status = 'settled', payout_id = ?, updated_at = datetime('now')
     WHERE id IN (${placeholders})`
  ).bind(payoutId, ...incomeIds).run();

  console.log(`[Reconcile] user=${userId} source=${source} period=${periodStart}..${periodEnd}: ${rows.length} rows linked, ${totalUsdCents}c USD, predicted=${predictedDate}`);

  return {
    userId, source, periodStart, periodEnd,
    payoutId,
    incomeRowsLinked: rows.length,
    amountUsdCents: totalUsdCents,
    status: 'created',
  };
}

export interface ReconcileSummary {
  payoutsCreated: number;
  payoutsSkipped: number;
  errored: number;
  usersProcessed: number;
  rowsSettled: number;
  autoMarkedPaid?: number;
  financeReportsApplied?: number;
}

/**
 * LED-38 — grace period before we auto-mark a predicted payout as paid.
 * Apple wires within ~33-45 days of period close. If we haven't heard
 * back from financeReports (sub-threshold periods never generate one),
 * we still want the user's Revenue page to show paid status — otherwise
 * predicted payouts pile up forever.
 */
const AUTO_MARK_GRACE_DAYS = 7;

/**
 * Auto-mark any 'predicted' payout whose predicted_date + grace has passed
 * as 'paid'. Adds metadata.auto_marked = true so the iOS app can flag it
 * as "assumed paid" rather than authoritative.
 *
 * This is conservative: we only flip the status when the wire is overdue.
 * If Apple's financeReports later supersedes with authoritative data, the
 * sync path overwrites the metadata.
 */
export async function autoMarkOverduePayouts(env: Env, asOfDate: Date = new Date()): Promise<number> {
  const cutoffMs = asOfDate.getTime() - AUTO_MARK_GRACE_DAYS * 86400_000;
  const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);

  const overdue = await env.DB.prepare(
    `SELECT id, predicted_date, period_end, metadata FROM payouts
     WHERE status = 'predicted'
       AND predicted_date IS NOT NULL
       AND predicted_date <= ?`
  ).bind(cutoff).all<{ id: string; predicted_date: string; period_end: string; metadata: string | null }>();

  let marked = 0;
  for (const row of overdue.results) {
    let metadata: Record<string, unknown> = {};
    try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch {}
    metadata.auto_marked = true;
    metadata.auto_marked_at = new Date().toISOString();
    metadata.auto_marked_reason = 'predicted_date_plus_grace_elapsed';

    await env.DB.prepare(
      `UPDATE payouts
       SET status = 'paid',
           paid_date = COALESCE(paid_date, predicted_date),
           metadata = ?,
           updated_at = datetime('now')
       WHERE id = ? AND status = 'predicted'`
    ).bind(JSON.stringify(metadata), row.id).run();

    await env.DB.prepare(
      `UPDATE income_transactions
       SET status = 'paid', updated_at = datetime('now')
       WHERE payout_id = ?`
    ).bind(row.id).run();

    marked++;
  }
  if (marked > 0) {
    console.log(`[Auto-mark] Flipped ${marked} overdue predicted payouts to paid (grace=${AUTO_MARK_GRACE_DAYS}d)`);
  }
  return marked;
}

/**
 * Run reconciliation for every (user, source) where the user has an active
 * integration. Called from the monthly cron. Failures on one user don't
 * block others.
 */
export async function reconcileAllUsers(
  env: Env, asOfDate: Date = new Date()
): Promise<ReconcileSummary> {
  const integrations = await env.DB.prepare(
    `SELECT user_id, id AS integration_id, provider
     FROM integrations
     WHERE is_active = 1 AND provider IN ('apple_app_store', 'google_play')`
  ).all<{ user_id: string; integration_id: string; provider: string }>();

  const users = new Set<string>();
  let payoutsCreated = 0;
  let payoutsSkipped = 0;
  let errored = 0;
  let rowsSettled = 0;

  for (const row of integrations.results) {
    if (!RECONCILED_SOURCES.includes(row.provider as ReconciledSource)) continue;
    users.add(row.user_id);
    try {
      const result = await reconcileOneSource(
        env, row.user_id, row.integration_id, row.provider as ReconciledSource, asOfDate
      );
      if (result.status === 'created') {
        payoutsCreated++;
        rowsSettled += result.incomeRowsLinked;
      } else {
        payoutsSkipped++;
      }
    } catch (e) {
      console.error(`[Reconcile] Failed for user=${row.user_id} source=${row.provider}:`, e);
      errored++;
    }
  }

  // LED-38: pull Apple finance reports for each Apple integration. When a
  // report exists for a region/month, it supersedes the predicted payout
  // with authoritative paid data. Sub-threshold months silently 404 and
  // fall through to the auto-mark grace path below.
  let financeReportsApplied = 0;
  const appleIntegrations = await env.DB.prepare(
    `SELECT user_id, id AS integration_id, credentials
     FROM integrations
     WHERE is_active = 1 AND provider = 'apple_app_store'`
  ).all<{ user_id: string; integration_id: string; credentials: string }>();

  const { decryptValue } = await import('../utils/crypto');
  const { syncAppleFinanceReports } = await import('./integrations/apple-finance-reports');

  for (const row of appleIntegrations.results) {
    try {
      const decrypted = await decryptValue(row.credentials, env.JWT_SECRET, row.user_id);
      const creds = JSON.parse(decrypted) as {
        issuer_id: string; key_id: string; private_key: string; vendor_number: string;
      };
      const result = await syncAppleFinanceReports(env, row.user_id, row.integration_id, creds);
      financeReportsApplied += result.payoutsCreated + result.payoutsUpdated;
    } catch (e) {
      console.error(`[Finance reports] user=${row.user_id}:`, e);
      errored++;
    }
  }

  // LED-38: auto-mark any predicted payout that's now past predicted_date
  // + grace as paid. Conservative — preserves authoritative finance data if
  // it later supersedes.
  const autoMarkedPaid = await autoMarkOverduePayouts(env, asOfDate);

  const summary: ReconcileSummary = {
    payoutsCreated,
    payoutsSkipped,
    errored,
    usersProcessed: users.size,
    rowsSettled,
    autoMarkedPaid,
    financeReportsApplied,
  };
  console.log(`[Reconcile] Run complete: ${JSON.stringify(summary)} (asOf=${asOfDate.toISOString()})`);
  return summary;
}
