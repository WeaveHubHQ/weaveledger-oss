import { Env } from '../../types';
import { generateId } from '../../utils/crypto';
import { getAppleJWT, getAppleServerJWT, decodeJWSPayload } from '../../utils/apple-jws';

interface AppleCredentials {
  issuer_id: string;
  key_id: string;
  private_key: string;
  vendor_number: string;
  // Optional: Admin-role key for App Store Server API (cancellation detection)
  server_key_id?: string;
  server_private_key?: string;
}

async function decompressGzip(blob: ArrayBuffer): Promise<string> {
  try {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(new Uint8Array(blob));
    writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const combined = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(combined);
  } catch {
    return new TextDecoder().decode(blob);
  }
}

function parseTSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split('\t');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
    return obj;
  });
}

function parseInterval(duration: string): { interval: string; count: number } {
  const lower = duration.toLowerCase();
  if (lower.includes('year') || lower.includes('annual')) return { interval: 'year', count: 1 };
  if (lower.includes('quarter') || lower.includes('3 month')) return { interval: 'month', count: 3 };
  if (lower.includes('2 month') || lower.includes('bi-month')) return { interval: 'month', count: 2 };
  if (lower.includes('6 month') || lower.includes('half')) return { interval: 'month', count: 6 };
  if (lower.includes('week')) return { interval: 'week', count: 1 };
  return { interval: 'month', count: 1 };
}

// Compute period end from a subscription start date + interval
function computePeriodEnd(startDate: string, interval: string, count: number): string {
  // S8: Guard against zero/negative count causing infinite loop
  if (count <= 0) count = 1;
  const d = new Date(startDate);
  if (interval === 'year') d.setFullYear(d.getFullYear() + count);
  else if (interval === 'month') d.setMonth(d.getMonth() + count);
  else if (interval === 'week') d.setDate(d.getDate() + 7 * count);
  else d.setDate(d.getDate() + count);

  // Walk forward until the period end is in the future (max 1000 iterations)
  const now = new Date();
  let iterations = 0;
  while (d <= now && iterations < 1000) {
    if (interval === 'year') d.setFullYear(d.getFullYear() + count);
    else if (interval === 'month') d.setMonth(d.getMonth() + count);
    else if (interval === 'week') d.setDate(d.getDate() + 7 * count);
    else d.setDate(d.getDate() + count);
    iterations++;
  }

  return d.toISOString().split('T')[0];
}

function computePeriodStart(periodEnd: string, interval: string, count: number): string {
  // S8: Guard against zero/negative count
  if (count <= 0) count = 1;
  const d = new Date(periodEnd);
  if (interval === 'year') d.setFullYear(d.getFullYear() - count);
  else if (interval === 'month') d.setMonth(d.getMonth() - count);
  else if (interval === 'week') d.setDate(d.getDate() - 7 * count);
  else d.setDate(d.getDate() - count);
  return d.toISOString().split('T')[0];
}

// Hardcoded fallback rates (approximate, updated March 2026)
const FALLBACK_RATES: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.53, JPY: 149.5,
  CHF: 0.88, CNY: 7.24, INR: 83.1, MXN: 17.1, BRL: 4.97, KRW: 1330,
  SGD: 1.34, HKD: 7.82, NOK: 10.5, SEK: 10.3, DKK: 6.87, NZD: 1.63,
  ZAR: 18.6, RUB: 92, TRY: 32, PLN: 3.95, THB: 35.5, TWD: 31.5,
  MYR: 4.72, PHP: 56, IDR: 15700, ILS: 3.65, AED: 3.67, SAR: 3.75,
  COP: 3950, CLP: 950, PEN: 3.72, EGP: 30.9, NGN: 1550, VND: 24500,
};

// Reasonable bounds for sanity checks on major currencies (relative to USD)
const RATE_BOUNDS: Record<string, [number, number]> = {
  EUR: [0.5, 2.0], GBP: [0.5, 2.0], CAD: [0.8, 2.5], AUD: [0.8, 2.5],
  JPY: [70, 300], CHF: [0.5, 2.0], CNY: [4, 12], INR: [50, 130],
};

// Fetch exchange rates and cache for the duration of the sync
async function getExchangeRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!res.ok) {
      console.warn(`Exchange rate API returned ${res.status}, using fallback rates`);
      return FALLBACK_RATES;
    }
    const data = await res.json<{ rates: Record<string, number> }>();
    const rates = data.rates;

    // Sanity check common currencies
    for (const [currency, [min, max]] of Object.entries(RATE_BOUNDS)) {
      const rate = rates[currency];
      if (rate !== undefined && (rate < min || rate > max)) {
        console.warn(`Exchange rate for ${currency} (${rate}) outside bounds [${min}, ${max}], using fallback rates`);
        return FALLBACK_RATES;
      }
    }

    return rates;
  } catch (e) {
    console.warn('Exchange rate API request failed, using fallback rates:', e);
    return FALLBACK_RATES;
  }
}

function convertToUsdCents(amount: number, currency: string, rates: Record<string, number>): number {
  const upper = currency.toUpperCase();
  if (upper === 'USD') return Math.round(amount * 100);
  const rate = rates[upper];
  if (!rate) return Math.round(amount * 100); // fallback: treat as USD if unknown
  return Math.round((amount / rate) * 100);
}

export async function syncAppleSubscriptions(
  env: Env, userId: string, integrationId: string, credentials: AppleCredentials
): Promise<{ synced: number; updated: number; errors: string[] }> {
  let synced = 0;
  let updated = 0;
  const errors: string[] = [];

  try {
    const jwt = await getAppleJWT(credentials);
    const rates = await getExchangeRates();

    // Fetch the Subscription Summary report for recent days to find all active subscriptions.
    // We check the last 7 days to catch any we might have missed.
    const today = new Date();
    const seenSubscribers = new Set<string>();

    for (let daysBack = 1; daysBack <= 30; daysBack++) {
      const d = new Date(today);
      d.setDate(d.getDate() - daysBack);
      const dateStr = d.toISOString().split('T')[0];

      // Subscriber Detail report — one row per subscriber event, includes Subscriber ID
      const url = `https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=DAILY&filter[reportDate]=${dateStr}&filter[reportSubType]=DETAILED&filter[reportType]=SUBSCRIBER&filter[vendorNumber]=${credentials.vendor_number}&filter[version]=1_3`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/a-gzip' },
      });

      if (response.status === 404) continue; // Report not available yet
      if (!response.ok) {
        const err = await response.text();
        errors.push(`Apple Subscriber report ${dateStr}: ${response.status} ${err.slice(0, 200)}`);
        continue;
      }

      const text = await decompressGzip(await response.arrayBuffer());
      const rows = parseTSV(text);

      for (const row of rows) {
        const subscriberId = row['Subscriber ID'];
        const subscriptionName = row['Subscription Name'] || '';
        const appName = row['App Name'] || '';
        const appAppleId = row['App Apple ID'] || '';
        const subscriptionAppleId = row['Subscription Apple ID'] || '';
        const duration = row['Standard Subscription Duration'] || '';
        const customerPrice = parseFloat(row['Customer Price'] || '0');
        const customerCurrency = row['Customer Currency'] || 'USD';
        const developerProceeds = parseFloat(row['Developer Proceeds'] || '0');
        const proceedsCurrency = row['Proceeds Currency'] || 'USD';
        const country = row['Country'] || '';
        const device = row['Device'] || '';
        const eventDate = row['Event Date'] || dateStr;
        const units = parseInt(row['Units'] || '1', 10);

        if (!subscriberId || seenSubscribers.has(subscriberId + subscriptionAppleId)) continue;
        seenSubscribers.add(subscriberId + subscriptionAppleId);

        // Convert developer proceeds to USD cents
        const amountCents = convertToUsdCents(developerProceeds, proceedsCurrency, rates);
        const { interval, count } = parseInterval(duration);

        // The source_subscription_id uniquely identifies this subscriber+product combo
        const sourceSubId = `apple_${subscriberId}_${subscriptionAppleId || subscriptionName}`;

        // Compute current period based on event date + billing interval
        const periodEnd = computePeriodEnd(eventDate, interval, count);
        const periodStart = computePeriodStart(periodEnd, interval, count);

        // Determine status: if units > 0 and price > 0, it's active.
        // Free trial: units > 0 but price = 0
        const isTrial = customerPrice === 0 && units > 0;
        const status = isTrial ? 'trialing' : 'active';

        const productId = subscriptionAppleId || subscriptionName;
        const productName = subscriptionName || `${appName} Subscription`;

        try {
          // Check if this subscription already exists
          const existing = await env.DB.prepare(
            "SELECT id FROM subscriptions WHERE source = 'apple_app_store' AND source_subscription_id = ?"
          ).bind(sourceSubId).first<{ id: string }>();

          if (existing) {
            // Update existing subscription
            await env.DB.prepare(
              `UPDATE subscriptions SET
                amount = ?, currency = 'USD', status = ?,
                current_period_start = ?, current_period_end = ?,
                product_name = ?, plan_interval = ?, plan_interval_count = ?,
                metadata = ?, updated_at = datetime('now')
              WHERE id = ?`
            ).bind(
              amountCents, status,
              periodStart, periodEnd,
              productName, interval, count,
              JSON.stringify({ subscriber_id: subscriberId, country, device, app_name: appName, app_apple_id: appAppleId, customer_price: customerPrice, customer_currency: customerCurrency, original_proceeds: developerProceeds, original_currency: proceedsCurrency }),
              existing.id
            ).run();
            updated++;
          } else {
            // Insert new subscription
            const id = generateId('sub');
            await env.DB.prepare(
              `INSERT INTO subscriptions
                (id, user_id, integration_id, source, source_subscription_id,
                 product_id, product_name, plan_interval, plan_interval_count,
                 amount, currency, status, started_at,
                 current_period_start, current_period_end,
                 customer_id, metadata)
              VALUES (?, ?, ?, 'apple_app_store', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              id, userId, integrationId, sourceSubId,
              productId, productName, interval, count,
              amountCents, 'USD', status, eventDate,
              periodStart, periodEnd,
              subscriberId,
              JSON.stringify({ country, device, app_name: appName, app_apple_id: appAppleId, customer_price: customerPrice, customer_currency: customerCurrency, original_proceeds: developerProceeds, original_currency: proceedsCurrency })
            ).run();
            synced++;
          }
        } catch (e) {
          // UNIQUE constraint or other DB error — skip
          errors.push(`DB error for ${sourceSubId}: ${e instanceof Error ? e.message : 'unknown'}`);
        }
      }
    }

    // Fallback: use Subscription Summary report only if the subscriber detail report
    // produced zero records (e.g., all subscriber events are older than 7 days).
    // This avoids creating duplicate summary records alongside detail records.
    if (seenSubscribers.size === 0) {
      for (let daysBack = 1; daysBack <= 3; daysBack++) {
        const d = new Date(today);
        d.setDate(d.getDate() - daysBack);
        const dateStr = d.toISOString().split('T')[0];

        const url = `https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=DAILY&filter[reportDate]=${dateStr}&filter[reportSubType]=SUMMARY&filter[reportType]=SUBSCRIPTION&filter[vendorNumber]=${credentials.vendor_number}&filter[version]=1_4`;

        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/a-gzip' },
        });

        if (!response.ok) continue;

        const text = await decompressGzip(await response.arrayBuffer());
        const rows = parseTSV(text);

        for (const row of rows) {
          const activeCount = parseInt(row['Active Standard Price Subscriptions'] || '0', 10);
          const subscriptionName = row['Subscription Name'] || '';
          const subscriptionAppleId = row['Subscription Apple ID'] || '';
          const country = row['Country'] || '';
          const developerProceeds = parseFloat(row['Developer Proceeds'] || '0');
          const proceedsCurrency = row['Proceeds Currency'] || 'USD';
          const duration = row['Standard Subscription Duration'] || '';
          const appName = row['App Name'] || '';

          if (activeCount <= 0 || !subscriptionName) continue;

          const amountCents = convertToUsdCents(developerProceeds, proceedsCurrency, rates);
          const { interval, count } = parseInterval(duration);
          const sourceSubId = `apple_summary_${subscriptionAppleId || subscriptionName}_${country}`;

          const exists = await env.DB.prepare(
            "SELECT id FROM subscriptions WHERE source = 'apple_app_store' AND source_subscription_id = ?"
          ).bind(sourceSubId).first<{ id: string }>();

          if (exists) {
            await env.DB.prepare(
              `UPDATE subscriptions SET
                amount = ?, currency = 'USD', status = 'active',
                current_period_end = ?, updated_at = datetime('now')
              WHERE id = ?`
            ).bind(
              amountCents,
              computePeriodEnd(dateStr, interval, count),
              exists.id
            ).run();
            updated++;
          } else {
            const id = generateId('sub');
            const periodEnd = computePeriodEnd(dateStr, interval, count);
            try {
              await env.DB.prepare(
                `INSERT INTO subscriptions
                  (id, user_id, integration_id, source, source_subscription_id,
                   product_id, product_name, plan_interval, plan_interval_count,
                   amount, currency, status, started_at,
                   current_period_start, current_period_end,
                   metadata)
                VALUES (?, ?, ?, 'apple_app_store', ?, ?, ?, ?, ?, ?, 'USD', 'active', ?, ?, ?, ?)`
              ).bind(
                id, userId, integrationId, sourceSubId,
                subscriptionAppleId || subscriptionName,
                subscriptionName || `${appName} Subscription`,
                interval, count,
                amountCents,
                dateStr,
                computePeriodStart(periodEnd, interval, count), periodEnd,
                JSON.stringify({ country, app_name: appName, source_type: 'summary' })
              ).run();
              synced++;
            } catch {
              // UNIQUE constraint
            }
          }
        }

        // Only need the first available day's summary
        break;
      }
    }

    // Mark subscriptions that are no longer in the active reports as potentially canceled
    // Only do this for subscriptions whose period_end has passed
    const now = new Date().toISOString().split('T')[0];
    await env.DB.prepare(
      `UPDATE subscriptions SET status = 'expired', updated_at = datetime('now')
       WHERE user_id = ? AND source = 'apple_app_store' AND status IN ('active', 'trialing')
       AND current_period_end < ?`
    ).bind(userId, now).run();

    // Server API pass: detect cancellations (auto-renew disabled) using Admin key
    if (credentials.server_key_id && credentials.server_private_key) {
      try {
        await detectAppleCancellations(env, userId, credentials, errors);
      } catch (e) {
        errors.push(`Server API cancellation check: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Unknown Apple subscription sync error');
  }

  return { synced, updated, errors };
}

// Use the App Store Server API (Admin key) to detect subscriptions with auto-renew disabled
async function detectAppleCancellations(
  env: Env, userId: string, credentials: AppleCredentials, errors: string[]
): Promise<void> {
  // Get list of apps from App Store Connect API
  const connectJwt = await getAppleJWT(credentials);
  const appsRes = await fetch('https://api.appstoreconnect.apple.com/v1/apps?fields[apps]=bundleId,name', {
    headers: { Authorization: `Bearer ${connectJwt}` },
  });

  if (!appsRes.ok) {
    errors.push(`Failed to list apps for cancellation check: ${appsRes.status}`);
    return;
  }

  const appsData = await appsRes.json<{ data: Array<{ id: string; attributes: { bundleId: string; name: string } }> }>();

  // Build a JWT using the Server API (Admin) key for each app
  const serverCreds: AppleCredentials = {
    ...credentials,
    key_id: credentials.server_key_id!,
    private_key: credentials.server_private_key!,
  };

  for (const app of appsData.data) {
    const bundleId = app.attributes.bundleId;

    // Server API JWT needs the bundle ID in the payload
    const serverJwt = await getAppleServerJWT(serverCreds, bundleId);

    const res = await fetch('https://api.storekit.itunes.apple.com/inApps/v1/notifications/history', {
      method: 'POST',
      headers: { Authorization: `Bearer ${serverJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: Date.now() - (30 * 24 * 60 * 60 * 1000),
        endDate: Date.now(),
      }),
    });

    if (!res.ok) continue; // 401 = app has no IAP, skip

    const data = await res.json<{ notificationHistory: Array<{ signedPayload: string }>; hasMore: boolean }>();

    for (const notif of (data.notificationHistory || [])) {
      try {
        const decoded = decodeJWSPayload(notif.signedPayload) as Record<string, unknown>;

        if (decoded.notificationType !== 'DID_CHANGE_RENEWAL_STATUS') continue;
        if (decoded.subtype !== 'AUTO_RENEW_DISABLED') continue;

        const decodedData = decoded.data as Record<string, unknown> | undefined;
        const signedTxnInfo = decodedData?.signedTransactionInfo as string | undefined;
        const txnInfo = signedTxnInfo
          ? decodeJWSPayload(signedTxnInfo) as Record<string, unknown>
          : null;

        if (!txnInfo) continue;

        const expiresDate = txnInfo.expiresDate
          ? new Date(txnInfo.expiresDate as number).toISOString().split('T')[0]
          : null;

        if (!expiresDate) continue;

        const matched = await env.DB.prepare(
          `SELECT id, current_period_end, metadata FROM subscriptions
           WHERE user_id = ? AND source = 'apple_app_store'
           AND status IN ('active', 'trialing')
           AND cancel_at IS NULL`
        ).bind(userId).all<{ id: string; current_period_end: string; metadata: string }>();

        for (const sub of matched.results) {
          const meta = JSON.parse(sub.metadata || '{}');
          if (String(meta.app_apple_id || '') !== String(app.id)) continue;

          const subEnd = new Date(sub.current_period_end).getTime();
          const notifEnd = new Date(expiresDate).getTime();
          const diffDays = Math.abs(subEnd - notifEnd) / (1000 * 60 * 60 * 24);

          if (diffDays <= 3) {
            // cancel_at = when subscription ends, canceled_at = when user turned off auto-renew
            const canceledAt = decoded.signedDate
              ? new Date(decoded.signedDate as number).toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0];
            await env.DB.prepare(
              `UPDATE subscriptions SET cancel_at = ?, canceled_at = ?, updated_at = datetime('now') WHERE id = ?`
            ).bind(expiresDate, canceledAt, sub.id).run();
          }
        }
      } catch {
        // Skip malformed notifications
      }
    }
  }
}
