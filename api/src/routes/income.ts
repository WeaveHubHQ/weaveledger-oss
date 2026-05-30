import { Env } from '../types';
import { generateId, encryptValue, decryptValue } from '../utils/crypto';
import { error, success } from '../utils/response';

type Provider = 'stripe' | 'google_play' | 'apple_app_store';

export async function listIntegrations(request: Request, env: Env, userId: string): Promise<Response> {
  const results = await env.DB.prepare(
    'SELECT id, provider, is_active, last_sync_at, last_sync_status, last_sync_error, created_at FROM integrations WHERE user_id = ?'
  ).bind(userId).all();

  return success(results.results);
}

export async function upsertIntegration(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ provider: string; credentials: Record<string, string> }>();

  const validProviders: Provider[] = ['stripe', 'google_play', 'apple_app_store'];
  if (!validProviders.includes(body.provider as Provider)) {
    return error('Invalid provider. Must be: stripe, google_play, or apple_app_store.');
  }

  // Validate required credential fields
  const provider = body.provider as Provider;
  if (provider === 'stripe' && !body.credentials.api_key) {
    return error('Stripe API key is required.');
  }
  if (provider === 'google_play' && (!body.credentials.client_email || !body.credentials.private_key || !body.credentials.package_name)) {
    return error('Google Play requires client_email, private_key, and package_name.');
  }
  if (provider === 'apple_app_store' && (!body.credentials.issuer_id || !body.credentials.key_id || !body.credentials.private_key || !body.credentials.vendor_number)) {
    return error('Apple App Store requires issuer_id, key_id, private_key, and vendor_number.');
  }

  const encrypted = await encryptValue(JSON.stringify(body.credentials), env.JWT_SECRET, userId);

  // Upsert: update if exists, insert if not
  const existing = await env.DB.prepare(
    'SELECT id FROM integrations WHERE user_id = ? AND provider = ?'
  ).bind(userId, provider).first<{ id: string }>();

  if (existing) {
    await env.DB.prepare(
      "UPDATE integrations SET credentials = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(encrypted, existing.id).run();
    return success({ id: existing.id }, 'Integration updated');
  }

  const id = generateId('int');
  await env.DB.prepare(
    'INSERT INTO integrations (id, user_id, provider, credentials) VALUES (?, ?, ?, ?)'
  ).bind(id, userId, provider, encrypted).run();

  return success({ id }, 'Integration created');
}

export async function deleteIntegration(request: Request, env: Env, userId: string, integrationId: string): Promise<Response> {
  const result = await env.DB.prepare(
    'DELETE FROM integrations WHERE id = ? AND user_id = ?'
  ).bind(integrationId, userId).run();

  if (!result.meta.changes) return error('Integration not found', 404);
  return success(null, 'Integration removed');
}

// Core sync logic reused by both the API route and the scheduled cron handler
async function syncIntegrationCore(
  env: Env,
  integration: { id: string; provider: Provider; credentials: string; last_sync_at: string | null },
  userId: string
): Promise<{ synced: number; errors: string[]; status: string }> {
  const decrypted = await decryptValue(integration.credentials, env.JWT_SECRET, userId);
  const creds: Record<string, string> = JSON.parse(decrypted);

  let result: { synced: number; errors: string[] };

  try {
    switch (integration.provider) {
      case 'stripe': {
        const { syncStripe } = await import('../services/integrations/stripe');
        result = await syncStripe(env, userId, integration.id, creds.api_key, integration.last_sync_at);
        // Also sync subscriptions
        try {
          const { syncStripeSubscriptions } = await import('../services/integrations/stripe-subscriptions');
          await syncStripeSubscriptions(env, userId, integration.id, creds.api_key);
        } catch (e) {
          result.errors.push(`Subscription sync: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        break;
      }
      case 'google_play': {
        const { syncGooglePlay } = await import('../services/integrations/google-play');
        result = await syncGooglePlay(env, userId, integration.id, {
          client_email: creds.client_email,
          private_key: creds.private_key,
          package_name: creds.package_name,
        }, integration.last_sync_at);
        break;
      }
      case 'apple_app_store': {
        const { syncAppleAppStore } = await import('../services/integrations/apple-app-store');
        result = await syncAppleAppStore(env, userId, integration.id, {
          issuer_id: creds.issuer_id,
          key_id: creds.key_id,
          private_key: creds.private_key,
          vendor_number: creds.vendor_number,
        }, integration.last_sync_at);
        // Also sync subscriptions
        try {
          const { syncAppleSubscriptions } = await import('../services/integrations/apple-subscriptions');
          await syncAppleSubscriptions(env, userId, integration.id, {
            issuer_id: creds.issuer_id,
            key_id: creds.key_id,
            private_key: creds.private_key,
            vendor_number: creds.vendor_number,
            server_key_id: creds.server_key_id,
            server_private_key: creds.server_private_key,
          });
        } catch (e) {
          result.errors.push(`Subscription sync: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        break;
      }
      default:
        throw new Error('Unknown provider');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    await env.DB.prepare(
      "UPDATE integrations SET last_sync_status = 'error', last_sync_error = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(msg.slice(0, 500), integration.id).run();
    throw e;
  }

  const status = result.errors.length > 0 ? 'partial' : 'success';
  // LED-31: bumped from 500 -> 2000 so multi-month Apple sync errors aren't
  // truncated mid-message. Column is TEXT so no schema change needed.
  await env.DB.prepare(
    "UPDATE integrations SET last_sync_at = datetime('now'), last_sync_status = ?, last_sync_error = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(status, result.errors.length > 0 ? result.errors.join('; ').slice(0, 2000) : null, integration.id).run();

  return { synced: result.synced, errors: result.errors, status };
}

export async function syncIntegration(request: Request, env: Env, userId: string, integrationId: string): Promise<Response> {
  const integration = await env.DB.prepare(
    'SELECT id, provider, credentials, last_sync_at FROM integrations WHERE id = ? AND user_id = ?'
  ).bind(integrationId, userId).first<{ id: string; provider: Provider; credentials: string; last_sync_at: string | null }>();

  if (!integration) return error('Integration not found', 404);

  try {
    const result = await syncIntegrationCore(env, integration, userId);
    return success(result, `Synced ${result.synced} transactions`);
  } catch (e) {
    console.error(`Sync failed for integration ${integrationId}:`, e);
    return error('Sync failed. Please check your integration credentials and try again.');
  }
}

// Called by the cron trigger to sync all active integrations
export async function syncAllIntegrations(env: Env): Promise<void> {
  const integrations = await env.DB.prepare(
    'SELECT i.id, i.provider, i.credentials, i.last_sync_at, i.user_id FROM integrations i WHERE i.is_active = 1'
  ).all<{ id: string; provider: Provider; credentials: string; last_sync_at: string | null; user_id: string }>();

  for (const integration of integrations.results) {
    try {
      const result = await syncIntegrationCore(env, integration, integration.user_id);
      console.log(`Cron sync ${integration.provider} (${integration.id}): ${result.synced} synced, ${result.errors.length} errors`);
    } catch (e) {
      console.error(`Cron sync failed for ${integration.provider} (${integration.id}):`, e);
    }
  }
}

export async function listIncomeTransactions(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');
  const page = Math.max(parseInt(url.searchParams.get('page') || '1') || 1, 1);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 100);
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM income_transactions WHERE user_id = ?';
  let countQuery = 'SELECT COUNT(*) as total FROM income_transactions WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (source) { query += ' AND source = ?'; countQuery += ' AND source = ?'; params.push(source); }
  if (dateFrom) { query += ' AND transaction_date >= ?'; countQuery += ' AND transaction_date >= ?'; params.push(dateFrom); }
  if (dateTo) { query += ' AND transaction_date <= ?'; countQuery += ' AND transaction_date <= ?'; params.push(dateTo); }

  const total = await env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();

  query += ' ORDER BY transaction_date DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const results = await env.DB.prepare(query).bind(...params).all();

  return success({
    transactions: results.results,
    pagination: {
      page, limit,
      total: total?.total || 0,
      pages: Math.ceil((total?.total || 0) / limit),
    },
  });
}

// LED-33/34/35/36: payouts CRUD + dashboard summary for the new revenue
// lifecycle. Powers the iOS Revenue page sections (Forecast / Awaiting
// Payout / Recent Payouts / YTD Paid).

export async function listPayouts(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status'); // 'predicted' | 'paid' | 'all'

  let query = `SELECT id, source, source_payout_id, status, amount_local_cents, currency,
                      amount_usd_cents, fx_rate, period_start, period_end,
                      predicted_date, paid_date, bank_reference, metadata, created_at, updated_at
               FROM payouts WHERE user_id = ?`;
  const params: (string | number)[] = [userId];
  if (status && status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  }
  // Recent first: predicted by predicted_date, paid by paid_date, falling
  // back to created_at when neither is set.
  query += ` ORDER BY COALESCE(paid_date, predicted_date, created_at) DESC LIMIT 100`;

  const results = await env.DB.prepare(query).bind(...params).all();
  return success(results.results);
}

export async function markPayoutReceived(
  request: Request, env: Env, userId: string, payoutId: string,
): Promise<Response> {
  const body = await request.json<{ paid_date?: string; bank_reference?: string }>()
    .catch(() => ({} as { paid_date?: string; bank_reference?: string }));

  const row = await env.DB.prepare(
    `SELECT id, status FROM payouts WHERE id = ? AND user_id = ?`
  ).bind(payoutId, userId).first<{ id: string; status: string }>();
  if (!row) return error('Payout not found', 404);
  if (row.status === 'paid') return error('Payout is already marked paid', 409);

  const paidDate = body.paid_date || new Date().toISOString().slice(0, 10);
  const bankRef = body.bank_reference || null;

  await env.DB.prepare(
    `UPDATE payouts
     SET status = 'paid', paid_date = ?, bank_reference = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(paidDate, bankRef, payoutId).run();

  // Cascade: mark all linked income_transactions as 'paid' too.
  await env.DB.prepare(
    `UPDATE income_transactions
     SET status = 'paid', updated_at = datetime('now')
     WHERE payout_id = ?`
  ).bind(payoutId).run();

  return success({ id: payoutId, status: 'paid', paid_date: paidDate, bank_reference: bankRef },
    'Payout marked received.');
}

/**
 * Dashboard tile summary: This Month Forecast / Awaiting Payout / YTD Paid.
 * All amounts are in USD cents (using usd_amount_cents and amount_usd_cents
 * from LED-33) so mixed-currency aggregation produces a meaningful number.
 */
export async function getIncomeDashboard(request: Request, env: Env, userId: string): Promise<Response> {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const monthStart = `${ym}-01`;
  const yearStart = `${now.getUTCFullYear()}-01-01`;

  // LED-39 (fees): each tile now exposes a gross/fee/net trio. usd_gross_cents
  // is what the customer paid, usd_fee_cents is the platform commission,
  // (usd_gross - usd_fee) is what the developer keeps. Income rows: net is
  // tracked per-row. Payouts: net is the wire amount (commission already
  // deducted upstream by Apple/Google), so net = amount_usd_cents and
  // we don't have a separate fee field on payouts — we sum row-level fees
  // for the linked income within the payout's period.

  // This Month: pending income in the current month.
  // LED-40: Stripe rows populate usd_amount_cents (net) but not
  // usd_gross_cents (Stripe doesn't expose gross/fee separately at the
  // balance_transaction level), so coalesce so Stripe revenue is visible.
  // For Apple/Google, usd_gross_cents is populated and wins.
  //
  // Fee accounting: legacy Stripe rows touched by migration 0021 have
  // usd_gross_cents = usd_amount_cents (= net, not real gross) AND a
  // derived usd_fee_cents — subtracting that fee would undercount net.
  // We therefore exclude Stripe entirely from fee aggregation until/unless
  // a real gross backfill lands. For Apple/Google, usd_fee_cents is the
  // true platform commission and is counted.
  const thisMonth = await env.DB.prepare(
    `SELECT COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents)), 0) AS gross_usd,
            COALESCE(SUM(CASE WHEN usd_gross_cents IS NOT NULL AND source != 'stripe' THEN COALESCE(usd_fee_cents, 0) ELSE 0 END), 0) AS fee_usd,
            COUNT(*) AS rows
     FROM income_transactions
     WHERE user_id = ? AND status = 'pending' AND transaction_date >= ?`
  ).bind(userId, monthStart).first<{ gross_usd: number; fee_usd: number; rows: number }>();

  // Awaiting Payout: predicted payouts' USD net, plus the fee implied by their
  // linked income rows.
  const awaiting = await env.DB.prepare(
    `SELECT COALESCE(SUM(p.amount_usd_cents), 0) AS net_usd,
            COUNT(p.id) AS payouts,
            COALESCE((SELECT SUM(i.usd_fee_cents) FROM income_transactions i
                      WHERE i.user_id = ? AND i.payout_id IN (
                        SELECT id FROM payouts WHERE user_id = ? AND status = 'predicted'
                      )), 0) AS fee_usd
     FROM payouts p WHERE p.user_id = ? AND p.status = 'predicted'`
  ).bind(userId, userId, userId).first<{ net_usd: number; payouts: number; fee_usd: number }>();

  // YTD Paid: paid payouts this calendar year + linked income fees.
  const ytdPaid = await env.DB.prepare(
    `SELECT COALESCE(SUM(p.amount_usd_cents), 0) AS net_usd,
            COUNT(p.id) AS payouts,
            COALESCE((SELECT SUM(i.usd_fee_cents) FROM income_transactions i
                      WHERE i.user_id = ? AND i.payout_id IN (
                        SELECT id FROM payouts WHERE user_id = ? AND status = 'paid' AND paid_date >= ?
                      )), 0) AS fee_usd
     FROM payouts p WHERE p.user_id = ? AND p.status = 'paid' AND p.paid_date >= ?`
  ).bind(userId, userId, yearStart, userId, yearStart).first<{ net_usd: number; payouts: number; fee_usd: number }>();

  const grossOf = (net: number, fee: number) => net + fee;

  return success({
    this_month_forecast: {
      gross_usd_cents: thisMonth?.gross_usd || 0,
      fee_usd_cents: thisMonth?.fee_usd || 0,
      net_usd_cents: (thisMonth?.gross_usd || 0) - (thisMonth?.fee_usd || 0),
      // Back-compat: existing iOS build expects `usd_cents` = "primary" total.
      // Default to net so the headline number is what the developer keeps.
      usd_cents: (thisMonth?.gross_usd || 0) - (thisMonth?.fee_usd || 0),
      rows: thisMonth?.rows || 0,
    },
    awaiting_payout: {
      net_usd_cents: awaiting?.net_usd || 0,
      fee_usd_cents: awaiting?.fee_usd || 0,
      gross_usd_cents: grossOf(awaiting?.net_usd || 0, awaiting?.fee_usd || 0),
      usd_cents: awaiting?.net_usd || 0,
      payouts: awaiting?.payouts || 0,
    },
    ytd_paid: {
      net_usd_cents: ytdPaid?.net_usd || 0,
      fee_usd_cents: ytdPaid?.fee_usd || 0,
      gross_usd_cents: grossOf(ytdPaid?.net_usd || 0, ytdPaid?.fee_usd || 0),
      usd_cents: ytdPaid?.net_usd || 0,
      payouts: ytdPaid?.payouts || 0,
    },
  });
}

export async function getIncomeSummary(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  let dateFilter = '';
  const params: string[] = [userId];
  if (dateFrom) { dateFilter += ' AND transaction_date >= ?'; params.push(dateFrom); }
  if (dateTo) { dateFilter += ' AND transaction_date <= ?'; params.push(dateTo); }

  // LED-39 (fees): expose gross + fee + net totals so the web Revenue page
  // can show three numbers instead of one ambiguous "total". Continue to
  // populate `total_cents` (= gross) for backwards compatibility.
  //
  // LED-40: Stripe rows populate usd_amount_cents (net) but not
  // usd_gross_cents, so `gross_cents` coalesces to include them; `net_cents`
  // subtracts whatever fee was captured (zero for Stripe). The
  // missing-USD heuristic also accepts usd_amount_cents as a "we have USD"
  // signal so Stripe rows aren't flagged.
  // LED-40: when usd_gross_cents IS NULL we fall back to usd_amount_cents
  // (Stripe path: usd_amount_cents = net). In that fallback we must NOT
  // also subtract usd_fee_cents — net is already net. Guard fee with a
  // CASE that only credits fee when gross is authoritative AND not Stripe:
  // migration 0021 set legacy Stripe rows' usd_gross_cents = usd_amount_cents
  // (= net) and derived a usd_fee_cents from amount/fee proportion. Both
  // are misleading for fee accounting, so we exclude source='stripe' from
  // the fee aggregation until a real Stripe gross backfill lands.
  const overview = await env.DB.prepare(
    `SELECT COUNT(*) as count,
            COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents)), 0) as total_cents,
            COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents)), 0) as gross_cents,
            COALESCE(SUM(CASE WHEN usd_gross_cents IS NOT NULL AND source != 'stripe' THEN COALESCE(usd_fee_cents, 0) ELSE 0 END), 0) as fee_cents,
            COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents) - CASE WHEN usd_gross_cents IS NOT NULL AND source != 'stripe' THEN COALESCE(usd_fee_cents, 0) ELSE 0 END), 0) as net_cents,
            SUM(CASE WHEN usd_gross_cents IS NULL AND usd_amount_cents IS NULL AND amount != 0 THEN 1 ELSE 0 END) as missing_usd_rows
     FROM income_transactions WHERE user_id = ?${dateFilter}`
  ).bind(...params).first();

  const bySource = await env.DB.prepare(
    `SELECT source, COUNT(*) as count,
            COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents)), 0) as total_cents,
            COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents)), 0) as gross_cents,
            COALESCE(SUM(CASE WHEN usd_gross_cents IS NOT NULL AND source != 'stripe' THEN COALESCE(usd_fee_cents, 0) ELSE 0 END), 0) as fee_cents,
            COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents) - CASE WHEN usd_gross_cents IS NOT NULL AND source != 'stripe' THEN COALESCE(usd_fee_cents, 0) ELSE 0 END), 0) as net_cents
     FROM income_transactions WHERE user_id = ?${dateFilter}
     GROUP BY source ORDER BY total_cents DESC`
  ).bind(...params).all();

  // LED-43: `by_month` feeds the Monthly Revenue chart. A trend chart is
  // by definition multi-bucket history; clipping it with the page's
  // date_from/date_to filter (used for the headline tiles) collapses the
  // chart to one bar whenever the window spans fewer than two calendar
  // months. Always return the trailing 12 calendar months regardless of
  // page filter. `overview` and `by_source` continue to honor the filter.
  const byMonth = await env.DB.prepare(
    `SELECT strftime('%Y-%m', transaction_date) as month, COUNT(*) as count,
            COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents)), 0) as total_cents,
            COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents)), 0) as gross_cents,
            COALESCE(SUM(CASE WHEN usd_gross_cents IS NOT NULL AND source != 'stripe' THEN COALESCE(usd_fee_cents, 0) ELSE 0 END), 0) as fee_cents,
            COALESCE(SUM(COALESCE(usd_gross_cents, usd_amount_cents) - CASE WHEN usd_gross_cents IS NOT NULL AND source != 'stripe' THEN COALESCE(usd_fee_cents, 0) ELSE 0 END), 0) as net_cents
     FROM income_transactions WHERE user_id = ?
     GROUP BY month ORDER BY month DESC LIMIT 12`
  ).bind(userId).all();

  return success({
    overview,
    by_source: bySource.results,
    by_month: byMonth.results,
  });
}
