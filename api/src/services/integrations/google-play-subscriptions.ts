import { Env } from '../../types';
import { generateId } from '../../utils/crypto';
import { convertToUsdCents } from '../../utils/fx';
import { minorUnitFactor } from '../../utils/currency';

interface GooglePlayCredentials {
  client_email: string;
  private_key: string;
  package_name: string;
}

interface SubscriptionV2Response {
  subscriptionState: string;
  startTime?: string;
  linkedPurchaseToken?: string;
  latestOrderId?: string;
  lineItems?: Array<{
    productId: string;
    expiryTime?: string;
    autoRenewingPlan?: {
      autoRenewEnabled: boolean;
      priceChangeDetails?: { newPrice?: { priceMicros?: string; currencyCode?: string } };
    };
    offerDetails?: {
      basePlanId?: string;
      offerTags?: string[];
    };
  }>;
  canceledStateContext?: {
    userInitiatedCancellation?: { cancelTime?: string };
    systemInitiatedCancellation?: {};
    developerInitiatedCancellation?: {};
  };
}

// Reuse the Google auth helper from google-play.ts
async function getGoogleAccessToken(creds: GooglePlayCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${encode(header)}.${encode(payload)}`;

  const pemBody = creds.private_key
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(signingInput)
  );

  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${encodedSig}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    throw new Error(`Google OAuth error: ${err.slice(0, 300)}`);
  }

  const tokenData = await tokenResponse.json<{ access_token: string }>();
  return tokenData.access_token;
}

// Map Google Play subscription states to our status enum.
// Note: SUBSCRIPTION_STATE_CANCELED means "auto-renew off, access remains
// until expiryTime" — equivalent to Stripe's active + cancel_at_period_end.
// True loss-of-access is SUBSCRIPTION_STATE_EXPIRED. Keeping CANCELED as
// 'active' (with canceled_at / cancel_at populated) matches how Stripe and
// Apple cancellations are modeled elsewhere in this codebase.
function mapGoogleState(state: string): string {
  switch (state) {
    case 'SUBSCRIPTION_STATE_ACTIVE': return 'active';
    case 'SUBSCRIPTION_STATE_CANCELED': return 'active';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD': return 'past_due';
    case 'SUBSCRIPTION_STATE_ON_HOLD': return 'unpaid';
    case 'SUBSCRIPTION_STATE_PAUSED': return 'paused';
    case 'SUBSCRIPTION_STATE_EXPIRED': return 'expired';
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED': return 'canceled';
    default: return 'active';
  }
}

// Infer billing interval from basePlanId (e.g. "monthly", "yearly", "weekly")
function inferInterval(basePlanId?: string): { interval: string; count: number } {
  if (!basePlanId) return { interval: 'month', count: 1 };
  const lower = basePlanId.toLowerCase();
  if (lower.includes('year') || lower.includes('annual')) return { interval: 'year', count: 1 };
  if (lower.includes('week')) return { interval: 'week', count: 1 };
  if (lower.includes('quarter')) return { interval: 'month', count: 3 };
  if (lower.includes('semi')) return { interval: 'month', count: 6 };
  return { interval: 'month', count: 1 };
}

// Handle a Google Play RTDN subscription notification
export async function handleGooglePlayNotification(
  env: Env,
  userId: string,
  integrationId: string,
  credentials: GooglePlayCredentials,
  purchaseToken: string,
  subscriptionId: string,
  notificationType: number
): Promise<void> {
  const accessToken = await getGoogleAccessToken(credentials);

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${credentials.package_name}/purchases/subscriptionsv2/tokens/${purchaseToken}`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Play subscription lookup failed: ${response.status} ${err.slice(0, 200)}`);
  }

  const sub = await response.json<SubscriptionV2Response>();
  const lineItem = sub.lineItems?.[0];
  if (!lineItem) return;

  const status = mapGoogleState(sub.subscriptionState);
  const { interval, count } = inferInterval(lineItem.offerDetails?.basePlanId);

  // Price: use priceChangeDetails if available, otherwise look up from catalog
  let priceMicros = lineItem.autoRenewingPlan?.priceChangeDetails?.newPrice?.priceMicros;
  let currency = lineItem.autoRenewingPlan?.priceChangeDetails?.newPrice?.currencyCode || 'USD';
  // LED-40: micros are always 1e6 per major unit. Convert to the currency's
  // actual minor-unit count: USD/EUR factor 100 → micros/10000;
  // JPY/KRW factor 1 → micros/1_000_000; BHD factor 1000 → micros/1000.
  let amount = priceMicros
    ? Math.round(parseInt(priceMicros) / (1_000_000 / minorUnitFactor(currency)))
    : 0;

  // If no price from subscription response, look up from the product catalog
  if (amount === 0) {
    try {
      const catalogUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${credentials.package_name}/subscriptions/${lineItem.productId}`;
      const catalogResp = await fetch(catalogUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (catalogResp.ok) {
        const catalog = await catalogResp.json<{
          basePlans?: Array<{
            basePlanId: string;
            regionalConfigs?: Array<{
              regionCode: string;
              price: { currencyCode: string; units?: string; nanos?: number };
            }>;
          }>;
        }>();
        // Find the matching base plan
        const basePlanId = lineItem.offerDetails?.basePlanId;
        const plan = catalog.basePlans?.find(p => p.basePlanId === basePlanId) || catalog.basePlans?.[0];
        if (plan) {
          const usdConfig = plan.regionalConfigs?.find(r => r.regionCode === 'US') || plan.regionalConfigs?.[0];
          if (usdConfig) {
            const units = parseInt(usdConfig.price.units || '0');
            const nanos = usdConfig.price.nanos || 0;
            currency = usdConfig.price.currencyCode || 'USD';
            // LED-40: minor-unit count = units * factor + (nanos / 1e9) * factor.
            const factor = minorUnitFactor(currency);
            amount = units * factor + Math.round(nanos / (1_000_000_000 / factor));
          }
        }
      }
    } catch (e) {
      console.error('Failed to look up catalog price:', e);
    }
  }

  // Store developer proceeds (after Google's 15% commission) rather than list price
  amount = Math.round(amount * 0.85);

  const startedAt = sub.startTime ? sub.startTime.split('T')[0] : new Date().toISOString().split('T')[0];
  const periodEnd = lineItem.expiryTime ? lineItem.expiryTime.split('T')[0] : startedAt;

  // Calculate period start based on interval
  const endDate = new Date(periodEnd);
  const periodStart = new Date(endDate);
  if (interval === 'month') periodStart.setMonth(periodStart.getMonth() - count);
  else if (interval === 'year') periodStart.setFullYear(periodStart.getFullYear() - count);
  else if (interval === 'week') periodStart.setDate(periodStart.getDate() - 7 * count);
  else periodStart.setDate(periodStart.getDate() - count);

  const canceledAt = sub.canceledStateContext?.userInitiatedCancellation?.cancelTime?.split('T')[0] || null;
  const cancelAt = (status === 'canceled' && lineItem.expiryTime)
    ? lineItem.expiryTime.split('T')[0]
    : null;

  const id = generateId('sub');
  await env.DB.prepare(
    `INSERT INTO subscriptions
     (id, user_id, integration_id, source, source_subscription_id, product_id, product_name,
      plan_interval, plan_interval_count, amount, currency, status, started_at,
      current_period_start, current_period_end, canceled_at, cancel_at, metadata)
     VALUES (?, ?, ?, 'google_play', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, source_subscription_id) DO UPDATE SET
       status = excluded.status,
       amount = CASE WHEN excluded.amount > 0 THEN excluded.amount ELSE subscriptions.amount END,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       canceled_at = excluded.canceled_at,
       cancel_at = excluded.cancel_at,
       metadata = excluded.metadata,
       updated_at = datetime('now')`
  ).bind(
    id, userId, integrationId, purchaseToken,
    lineItem.productId, lineItem.productId,
    interval, count,
    amount, currency.toUpperCase(),
    status, startedAt,
    periodStart.toISOString().split('T')[0], periodEnd,
    canceledAt, cancelAt,
    JSON.stringify(sub)
  ).run();

  // LED-37: on REVOKED (type 12) write a negative income row referencing the
  // most recent positive order for this purchase token. Google's next payout
  // will already reflect the chargeback / refund.
  if (notificationType === 12) {
    try {
      await writeGooglePlayRefundIncome(env, userId, integrationId, purchaseToken, sub.latestOrderId);
    } catch (e) {
      console.error('[GP RTDN] Failed to write refund row:', e);
    }
  }

  // LED-31: write an income_transactions row for revenue-bearing events.
  // Notification types per Google's RTDN spec:
  //   1 = RECOVERED      (canceled sub returned to active)
  //   2 = RENEWED        (auto-renewal succeeded)
  //   4 = PURCHASED      (first-time subscription purchase)
  //   6 = RENEWED (price change applied)
  //   7 = RESTARTED      (restarted after cancellation)
  // We intentionally do NOT write income for type 3 (CANCELED), 5 (ON_HOLD),
  // 10 (PAUSED), 13 (EXPIRED) — those don't represent revenue.
  // Type 12 (REVOKED) is handled above as a refund.
  const REVENUE_EVENTS = new Set<number>([1, 2, 4, 6, 7]);
  if (REVENUE_EVENTS.has(notificationType) && amount > 0) {
    // latestOrderId is unique per renewal. Falls back to a notification
    // timestamp if Google didn't include it (rare for recurring subs).
    const orderId = sub.latestOrderId || `${purchaseToken}_${notificationType}_${Date.now()}`;
    const txnId = `gp_${orderId}`;
    const txnDate = new Date().toISOString().split('T')[0];

    try {
      const incId = generateId('inc');
      const ccy = currency.toUpperCase();
      // LED-33: USD-normalize for cross-currency aggregation.
      const usd = await convertToUsdCents(env, amount, ccy, txnDate);
      if (!usd && amount !== 0) {
        console.warn(`[GP sync] FX miss: currency=${ccy} date=${txnDate} amount=${amount} — usd_amount_cents will be NULL`);
      }

      await env.DB.prepare(
        `INSERT OR IGNORE INTO income_transactions
         (id, user_id, integration_id, source, source_transaction_id, amount, currency, net_amount,
          transaction_date, description, product_name, metadata,
          usd_amount_cents, fx_rate, fx_rate_date, status)
         VALUES (?, ?, ?, 'google_play', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      ).bind(
        incId, userId, integrationId, txnId,
        amount, ccy, amount,
        txnDate,
        `Google Play: ${lineItem.productId}`,
        lineItem.productId,
        JSON.stringify({
          notification_type: notificationType,
          order_id: orderId,
          purchase_token: purchaseToken,
          subscription_state: sub.subscriptionState,
        }),
        usd?.usdCents ?? null,
        usd?.rate ?? null,
        usd?.rateDate ?? null
      ).run();
      console.log(`[GP RTDN] Income written for user=${userId} amount=${amount} ${ccy} order=${orderId} type=${notificationType}`);
    } catch (e) {
      console.error('[GP RTDN] Failed to write income row:', e);
    }
  }
}

/**
 * LED-37: write a negative income row for a Google Play REVOKED notification.
 * Idempotent on synthesized `gp_refund_<orderId>`. Looks up the positive row
 * by either latestOrderId or any source_transaction_id whose metadata
 * references this purchase_token.
 */
async function writeGooglePlayRefundIncome(
  env: Env,
  userId: string,
  integrationId: string,
  purchaseToken: string,
  latestOrderId: string | undefined,
): Promise<void> {
  // Find the most recent positive income row for this purchase token.
  // Match by source_transaction_id (gp_<orderId>) or by purchase_token in metadata.
  const positive = await env.DB.prepare(
    `SELECT id, amount, currency, net_amount, usd_amount_cents, fx_rate, fx_rate_date,
            product_name, description, source_transaction_id
     FROM income_transactions
     WHERE user_id = ? AND source = 'google_play'
       AND amount > 0
       AND (
         source_transaction_id = ?
         OR json_extract(metadata, '$.purchase_token') = ?
       )
     ORDER BY transaction_date DESC LIMIT 1`
  ).bind(userId, `gp_${latestOrderId || ''}`, purchaseToken).first<{
    id: string; amount: number; currency: string; net_amount: number;
    usd_amount_cents: number | null; fx_rate: number | null; fx_rate_date: string | null;
    product_name: string | null; description: string | null;
    source_transaction_id: string;
  }>();

  const refundOrderKey = latestOrderId || purchaseToken;
  const txnId = `gp_refund_${refundOrderKey}`;
  const date = new Date().toISOString().slice(0, 10);
  const id = generateId('inc');

  if (positive) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO income_transactions
       (id, user_id, integration_id, source, source_transaction_id, amount, currency, net_amount,
        transaction_date, description, product_name, metadata,
        usd_amount_cents, fx_rate, fx_rate_date, status)
       VALUES (?, ?, ?, 'google_play', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'settled')`
    ).bind(
      id, userId, integrationId, txnId,
      -positive.amount, positive.currency, -positive.net_amount,
      date,
      `Refund: ${positive.description || positive.product_name || 'Google Play purchase'}`,
      positive.product_name,
      JSON.stringify({
        refund: true,
        original_id: positive.id,
        original_transaction_id: positive.source_transaction_id,
        purchase_token: purchaseToken,
        order_id: latestOrderId,
      }),
      positive.usd_amount_cents !== null && positive.usd_amount_cents !== undefined
        ? -positive.usd_amount_cents : null,
      positive.fx_rate, positive.fx_rate_date,
    ).run();
    console.log(`[GP refund] Wrote negative row ${id} for original=${positive.id} (${-positive.amount} ${positive.currency})`);
  } else {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO income_transactions
       (id, user_id, integration_id, source, source_transaction_id, amount, currency, net_amount,
        transaction_date, description, metadata, status)
       VALUES (?, ?, ?, 'google_play', ?, 0, 'USD', 0, ?, ?, ?, 'settled')`
    ).bind(
      id, userId, integrationId, txnId, date,
      `Google Play refund (no matching purchase row): ${refundOrderKey}`,
      JSON.stringify({
        refund: true,
        orphan: true,
        purchase_token: purchaseToken,
        order_id: latestOrderId,
      })
    ).run();
    console.warn(`[GP refund] Orphan refund for token=${purchaseToken} order=${latestOrderId} — no matching positive row`);
  }
}

// Backfill: build subscription records from existing income_transactions.
// Groups Google Play orders by base order ID (subscription orders have ..0, ..1 suffixes
// for renewals). Creates a subscription record from the most recent order in each group.
export async function backfillGooglePlaySubscriptions(
  env: Env, userId: string, integrationId: string, credentials: GooglePlayCredentials
): Promise<{ synced: number; errors: string[] }> {
  let synced = 0;
  const errors: string[] = [];

  // Get all Google Play income transactions for this user
  const transactions = await env.DB.prepare(
    `SELECT source_transaction_id, amount, currency, transaction_date, product_name, metadata
     FROM income_transactions
     WHERE user_id = ? AND source = 'google_play' AND integration_id = ?
     ORDER BY transaction_date DESC`
  ).bind(userId, integrationId).all<{
    source_transaction_id: string;
    amount: number;
    currency: string;
    transaction_date: string;
    product_name: string | null;
    metadata: string | null;
  }>();

  // Group by base order ID (strip renewal suffix like ..0, ..1)
  const subscriptionGroups = new Map<string, typeof transactions.results>();

  for (const tx of transactions.results) {
    // Subscription orders: GPA.1234-5678-9012-34567..0 (..N = renewal number)
    const orderId = tx.source_transaction_id;
    const baseId = orderId.replace(/\.\.\d+$/, '');

    // Only include orders that look like subscriptions (have renewal suffixes or repeat)
    if (!subscriptionGroups.has(baseId)) {
      subscriptionGroups.set(baseId, []);
    }
    subscriptionGroups.get(baseId)!.push(tx);
  }

  for (const [baseOrderId, orders] of subscriptionGroups) {
    // Need at least 1 order — single orders could be one-time purchases
    // Use the most recent order for current state
    const latest = orders[0]; // already sorted DESC
    const earliest = orders[orders.length - 1];

    // Infer interval from gap between orders if we have 2+
    let interval = 'month';
    let intervalCount = 1;

    if (orders.length >= 2) {
      const d1 = new Date(orders[0].transaction_date);
      const d2 = new Date(orders[1].transaction_date);
      const daysBetween = Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24);

      if (daysBetween > 300) { interval = 'year'; intervalCount = 1; }
      else if (daysBetween > 80) { interval = 'month'; intervalCount = 3; }
      else if (daysBetween > 20) { interval = 'month'; intervalCount = 1; }
      else if (daysBetween > 5) { interval = 'week'; intervalCount = 1; }
    }

    // Calculate expected next period end
    const lastDate = new Date(latest.transaction_date);
    const periodEnd = new Date(lastDate);
    if (interval === 'month') periodEnd.setMonth(periodEnd.getMonth() + intervalCount);
    else if (interval === 'year') periodEnd.setFullYear(periodEnd.getFullYear() + intervalCount);
    else if (interval === 'week') periodEnd.setDate(periodEnd.getDate() + 7 * intervalCount);

    // If period end is in the past, subscription is likely expired/canceled
    const now = new Date();
    const status = periodEnd < now ? 'expired' : 'active';

    try {
      const id = generateId('sub');
      await env.DB.prepare(
        `INSERT INTO subscriptions
         (id, user_id, integration_id, source, source_subscription_id, product_id, product_name,
          plan_interval, plan_interval_count, amount, currency, status, started_at,
          current_period_start, current_period_end, metadata)
         VALUES (?, ?, ?, 'google_play', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, source_subscription_id) DO UPDATE SET
           status = excluded.status,
           current_period_start = excluded.current_period_start,
           current_period_end = excluded.current_period_end,
           updated_at = datetime('now')`
      ).bind(
        id, userId, integrationId, baseOrderId,
        latest.product_name, latest.product_name,
        interval, intervalCount,
        latest.amount, latest.currency,
        status, earliest.transaction_date,
        latest.transaction_date, periodEnd.toISOString().split('T')[0],
        JSON.stringify({ order_count: orders.length, base_order_id: baseOrderId })
      ).run();
      synced++;
    } catch (e) {
      errors.push(`Failed to backfill ${baseOrderId}: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }

  return { synced, errors };
}
