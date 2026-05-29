import { Env } from '../../types';
import { generateId } from '../../utils/crypto';
import { getAppleJWT } from '../../utils/apple-jws';
import { convertToUsdCents } from '../../utils/fx';
import { toMinorUnits } from '../../utils/currency';

interface AppleCredentials {
  issuer_id: string;
  key_id: string;
  private_key: string;
  vendor_number: string;
}

// LED-32: switched from financeReports (which returned 404 for every
// region/type/date combo despite a valid Finance API key and matching vendor
// number — likely an Apple-side vendor quirk) to salesReports.
//
// salesReports is global by default (no region iteration needed), Apple
// already does the commission math via the "Developer Proceeds" column, and
// one MONTHLY call returns all apps under the vendor in a single TSV.
//
// We pull 6 months of trailing MONTHLY SALES SUMMARY reports — long enough
// to cover anything Apple has finalized that we might have missed.
const SALES_LOOKBACK_MONTHS = 6;

// Apple's MONTHLY SALES SUMMARY columns vary slightly across report versions.
// Pick the first column that exists for each logical field.
const COLUMN_ALIASES: Record<string, string[]> = {
  startDate: ['Begin Date', 'Start Date'],
  productId: ['Apple Identifier', 'SKU'],
  productName: ['Title', 'Product Type Identifier'],
  units: ['Units', 'Quantity'],
  proceeds: ['Developer Proceeds', 'Extended Partner Share', 'Partner Share'],
  currency: ['Currency of Proceeds', 'Partner Share Currency'],
  countryCode: ['Country Code', 'Provider Country'],
  // LED-39: gross customer price + their local currency so we can compute
  // the actual platform fee instead of guessing a rate.
  customerPrice: ['Customer Price'],
  customerCurrency: ['Customer Currency'],
};

function pickColumn(cols: string[], colMap: Record<string, number>, aliases: string[]): string {
  for (const name of aliases) {
    const idx = colMap[name];
    if (idx !== undefined && cols[idx] !== undefined) return cols[idx];
  }
  return '';
}

export async function syncAppleAppStore(
  env: Env, userId: string, integrationId: string, credentials: AppleCredentials, _lastSyncAt: string | null
): Promise<{ synced: number; errors: string[] }> {
  let synced = 0;
  const errors: string[] = [];

  try {
    const jwt = await getAppleJWT(credentials);

    // Build 6-month lookback list.
    const now = new Date();
    const months: string[] = [];
    for (let i = 0; i < SALES_LOOKBACK_MONTHS; i++) {
      const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }

    // Fetch all months in parallel — Cloudflare Workers paid plan allows up
    // to 1000 subrequests per request. 6 monthly fetches finish in a few
    // seconds total instead of 6× serial latency.
    const results = await Promise.all(
      months.map((m) => fetchAndParseSalesReport(jwt, credentials.vendor_number, m))
    );

    for (const r of results) {
      if (r.kind === 'error') {
        // 404 = report doesn't exist for that month (too recent, or vendor
        // had no sales that month). Not worth surfacing as an error.
        if (r.status !== 404) {
          errors.push(`Apple sales report ${r.reportDate}: HTTP ${r.status} ${r.body.slice(0, 200)}`);
        }
        continue;
      }

      for (const row of r.rows) {
        try {
          const id = generateId('inc');
          // LED-39: distinguish customer-paid (gross) from developer-proceeds (net).
          //   - proceeds in `Currency of Proceeds` (often differs from buyer's)
          //   - customer paid in `Customer Currency` (buyer's local currency)
          // Fee in USD = USD-gross - USD-net.  Both legs go through FX so the
          // sign and magnitude are correct even when currencies differ.
          // row.proceeds and row.customerPrice are already totals (per-unit × units).
          const netCurrency = row.currency.toUpperCase();
          const grossCurrency = (row.customerCurrency || netCurrency).toUpperCase();
          // LED-40: honor ISO 4217 minor-unit exponent. ¥500 → 500, not 50000.
          const netLocalCents = toMinorUnits(row.proceeds, netCurrency);
          const grossLocalCents = row.customerPrice !== null
            ? toMinorUnits(row.customerPrice, grossCurrency)
            : netLocalCents;

          const usdNet = await convertToUsdCents(env, netLocalCents, netCurrency, row.startDate);
          const usdGross = grossCurrency === netCurrency && grossLocalCents === netLocalCents
            ? usdNet
            : await convertToUsdCents(env, grossLocalCents, grossCurrency, row.startDate);
          if ((!usdNet || !usdGross) && netLocalCents !== 0) {
            console.warn(`[Apple sync] FX miss: net=${netCurrency} gross=${grossCurrency} date=${row.startDate} — fee will be NULL`);
          }
          const usdFeeCents = (usdGross && usdNet) ? Math.max(0, usdGross.usdCents - usdNet.usdCents) : null;
          const localFeeCents = grossCurrency === netCurrency
            ? Math.max(0, grossLocalCents - netLocalCents)
            : null;

          // Idempotent across multiple syncs. The (month, product, country,
          // row-index) tuple uniquely identifies a sales line within a vendor.
          const txnId = `apple_sales_${r.reportDate}_${row.productId}_${row.countryCode || 'XX'}_${row.rowIndex}`;
          // Use INSERT...ON CONFLICT so re-syncing a row written under the
          // pre-LED-39 convention (amount=net) upgrades it in place to the
          // new convention (amount=gross) — that's the backfill story for
          // Apple. Older fields are overwritten with the new authoritative
          // values; status/payout_id are preserved.
          await env.DB.prepare(
            `INSERT INTO income_transactions
             (id, user_id, integration_id, source, source_transaction_id,
              amount, currency, net_amount, fee_amount,
              transaction_date, description, product_name, metadata,
              usd_amount_cents, fx_rate, fx_rate_date, status,
              gross_amount, gross_currency, usd_gross_cents, usd_fee_cents)
             VALUES (?, ?, ?, 'apple_app_store', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
             ON CONFLICT(source, source_transaction_id) DO UPDATE SET
               amount = excluded.amount,
               currency = excluded.currency,
               net_amount = excluded.net_amount,
               fee_amount = excluded.fee_amount,
               description = excluded.description,
               product_name = excluded.product_name,
               metadata = excluded.metadata,
               usd_amount_cents = excluded.usd_amount_cents,
               fx_rate = excluded.fx_rate,
               fx_rate_date = excluded.fx_rate_date,
               gross_amount = excluded.gross_amount,
               gross_currency = excluded.gross_currency,
               usd_gross_cents = excluded.usd_gross_cents,
               usd_fee_cents = excluded.usd_fee_cents,
               updated_at = datetime('now')`
          ).bind(
            id, userId, integrationId, txnId,
            // amount = gross (LED-39 convention)
            grossLocalCents, grossCurrency, netLocalCents, localFeeCents,
            row.startDate,
            `App Store: ${row.productName || row.productId}${row.countryCode ? ` (${row.countryCode})` : ''}`,
            row.productName || row.productId,
            JSON.stringify({
              units: row.units,
              proceeds_per_unit: row.proceeds,
              customer_price_per_unit: row.customerPrice ?? null,
              customer_currency: row.customerCurrency ?? null,
              proceeds_currency: netCurrency,
              product_id: row.productId,
              country_code: row.countryCode,
              report_date: r.reportDate,
            }),
            // usd_amount_cents now means USD-gross (rename semantics, LED-39)
            usdGross?.usdCents ?? null,
            usdGross?.rate ?? null,
            usdGross?.rateDate ?? null,
            grossLocalCents, grossCurrency,
            usdGross?.usdCents ?? null,
            usdFeeCents,
          ).run();
          synced++;
        } catch (e) {
          console.error(`[Apple sales] insert failed for ${r.reportDate}/${row.productId}:`, e);
        }
      }
      console.log(`[Apple sales] ${r.reportDate}: ${r.rows.length} rows synced, ${r.skipped} skipped`);
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Unknown Apple API error');
  }

  return { synced, errors };
}

type SalesFetchResult =
  | {
      kind: 'ok';
      reportDate: string;
      rows: Array<{
        startDate: string;
        productId: string;
        productName: string;
        units: number;
        proceeds: number;         // total proceeds (per-unit × units)
        currency: string;
        countryCode: string;
        rowIndex: number;
        customerPrice: number | null;   // total customer price (per-unit × units)
        customerCurrency: string | null;
      }>;
      skipped: number;
    }
  | { kind: 'error'; reportDate: string; status: number; body: string };

async function fetchAndParseSalesReport(
  jwt: string, vendorNumber: string, reportDate: string,
): Promise<SalesFetchResult> {
  // MONTHLY SALES SUMMARY: one TSV per (vendor, month) covering all apps &
  // all regions. Per Apple's docs, this combination requires version=1_0.
  // (version=1_1 is for SUBSCRIPTION/SUBSCRIPTION_EVENT reports; using 1_1
  // here returns PARAMETER_ERROR.INVALID.)
  const url = `https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=MONTHLY&filter[reportSubType]=SUMMARY&filter[reportType]=SALES&filter[vendorNumber]=${vendorNumber}&filter[reportDate]=${reportDate}&filter[version]=1_0`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/a-gzip' },
    });
  } catch (e) {
    return { kind: 'error', reportDate, status: 0, body: e instanceof Error ? e.message : 'fetch threw' };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { kind: 'error', reportDate, status: response.status, body: body.replace(/\s+/g, ' ') };
  }

  const blob = await response.arrayBuffer();
  let text: string;
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
    text = new TextDecoder().decode(combined);
  } catch {
    text = new TextDecoder().decode(blob);
  }

  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) {
    return { kind: 'ok', reportDate, rows: [], skipped: 0 };
  }

  const headers = lines[0].split('\t').map((h) => h.trim());
  const colMap: Record<string, number> = {};
  headers.forEach((h, i) => { colMap[h] = i; });
  console.log(`[Apple sales] ${reportDate}: headers=[${headers.join('|')}]`);

  const rows: (SalesFetchResult & { kind: 'ok' })['rows'] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    // Apple's TSV gives Begin/Start Date as MM/DD/YYYY. Normalize to
    // YYYY-MM-DD so SQLite's strftime and our FX historical lookup work.
    const rawStartDate = pickColumn(cols, colMap, COLUMN_ALIASES.startDate) || `${reportDate}-01`;
    const startDate = normalizeAppleDate(rawStartDate, reportDate);
    const productId = pickColumn(cols, colMap, COLUMN_ALIASES.productId);
    const productName = pickColumn(cols, colMap, COLUMN_ALIASES.productName);
    const units = parseFloat(pickColumn(cols, colMap, COLUMN_ALIASES.units));
    const proceedsPerUnit = parseFloat(pickColumn(cols, colMap, COLUMN_ALIASES.proceeds));
    const currency = pickColumn(cols, colMap, COLUMN_ALIASES.currency) || 'USD';
    const countryCode = pickColumn(cols, colMap, COLUMN_ALIASES.countryCode);
    // LED-39: gross customer price (per unit) in the buyer's local currency.
    const customerPricePerUnit = parseFloat(pickColumn(cols, colMap, COLUMN_ALIASES.customerPrice));
    const customerCurrency = pickColumn(cols, colMap, COLUMN_ALIASES.customerCurrency);

    if (!Number.isFinite(units) || units <= 0 ||
        !Number.isFinite(proceedsPerUnit) || proceedsPerUnit <= 0) {
      skipped++;
      continue;
    }

    // Apple's SALES "Developer Proceeds" and "Customer Price" are both PER UNIT.
    // Total proceeds for the row = proceedsPerUnit × units; same for gross.
    const totalProceeds = proceedsPerUnit * units;
    const totalCustomerPrice = Number.isFinite(customerPricePerUnit) && customerPricePerUnit > 0
      ? customerPricePerUnit * units
      : null;

    rows.push({
      startDate,
      productId,
      productName,
      units,
      proceeds: totalProceeds,
      currency,
      countryCode,
      rowIndex: i,
      customerPrice: totalCustomerPrice,
      customerCurrency: customerCurrency || null,
    });
  }

  return { kind: 'ok', reportDate, rows, skipped };
}

/**
 * Apple TSV sales reports use MM/DD/YYYY for "Begin Date" / "Start Date".
 * Normalize to YYYY-MM-DD so SQLite date functions and our FX historical
 * lookup (which uses the date as a subdomain on currency-api.pages.dev)
 * work. Falls back to `<reportDate>-01` if the input is already iso or
 * unparseable.
 */
function normalizeAppleDate(raw: string, reportDate: string): string {
  if (!raw) return `${reportDate}-01`;
  // Already YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // MM/DD/YYYY → YYYY-MM-DD.
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  // ISO datetime — strip to date.
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  return `${reportDate}-01`;
}
