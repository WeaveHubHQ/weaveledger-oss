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

/**
 * LED-38 — Apple Finance Reports sync.
 *
 * Apple's financeReports endpoint provides authoritative settlement data:
 * the amount Apple has actually settled and will wire to the developer's
 * bank account. When a report exists for a (region, fiscal period), Apple
 * has already (or will imminently) wired that amount.
 *
 * IMPORTANT: financeReports ONLY exist when sales for a region cross
 * Apple's payout threshold (typically ~$150 USD equivalent per region).
 * Below threshold, Apple rolls the balance into the next month and no
 * report is generated. For small-revenue developers, most months return
 * 404 "There were no sales for the date specified." That's expected,
 * NOT an error.
 *
 * Strategy:
 *  1. For each (region, calendar-month) in the lookback window, attempt
 *     to fetch the FINANCIAL report.
 *  2. On 200: parse TSV, create or update a `payouts` row with status='paid',
 *     amount derived from "Total Owed To You", paid_date = report period
 *     end + 35d (Apple's typical wire latency).
 *  3. On 404 "no sales": silently skip.
 *  4. On other errors: log + collect.
 *
 * The companion path — auto-marking predicted payouts as paid past
 * predicted_date + grace — lives in `reconciliation.ts`.
 */

// Apple's settlement regions. These are NOT country codes; they're Apple's
// payout groupings (e.g. EU = single Eurozone settlement, WW = rest-of-world
// catch-all). Source: Apple App Store Connect → Payments → "Region" filter.
const SETTLEMENT_REGIONS = [
  'US', 'WW', 'EU', 'GB', 'AU', 'BR', 'CA', 'CH', 'CN', 'HK', 'IN',
  'JP', 'MX', 'NZ', 'RU', 'SG', 'TW', 'ZA',
];

// How many trailing fiscal months to scan. Apple posts a report ~5 days
// after fiscal month close; 6 months covers any backlog.
const LOOKBACK_MONTHS = 6;

const FINANCE_PAYOUT_DELAY_DAYS = 35;

export interface FinanceReportsSummary {
  reportsFound: number;
  payoutsCreated: number;
  payoutsUpdated: number;
  rowsLinked: number;
  errors: string[];
}

export async function syncAppleFinanceReports(
  env: Env,
  userId: string,
  integrationId: string,
  credentials: AppleCredentials,
): Promise<FinanceReportsSummary> {
  const summary: FinanceReportsSummary = {
    reportsFound: 0, payoutsCreated: 0, payoutsUpdated: 0, rowsLinked: 0, errors: [],
  };

  let jwt: string;
  try {
    jwt = await getAppleJWT(credentials);
  } catch (e) {
    summary.errors.push(`apple jwt: ${e instanceof Error ? e.message : String(e)}`);
    return summary;
  }

  // Build month list (calendar months — Apple's financeReports filter uses
  // YYYY-MM and internally maps to fiscal periods).
  const now = new Date();
  const months: string[] = [];
  for (let i = 1; i <= LOOKBACK_MONTHS; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  // Fetch all (region × month) in parallel — Workers paid plan supports it.
  const probes: Array<{ region: string; month: string }> = [];
  for (const month of months) {
    for (const region of SETTLEMENT_REGIONS) probes.push({ region, month });
  }

  const results = await Promise.all(probes.map((p) =>
    fetchFinanceReport(jwt, credentials.vendor_number, p.region, p.month)
      .then((r) => ({ ...p, result: r }))
  ));

  for (const r of results) {
    if (r.result.kind === 'no_sales') continue;
    if (r.result.kind === 'error') {
      summary.errors.push(`${r.region}/${r.month}: HTTP ${r.result.status} ${r.result.body.slice(0, 120)}`);
      continue;
    }
    summary.reportsFound++;

    try {
      const upserted = await upsertPayoutFromFinanceReport(
        env, userId, integrationId, r.region, r.month, r.result.rows,
      );
      if (upserted.created) summary.payoutsCreated++;
      else summary.payoutsUpdated++;
      summary.rowsLinked += upserted.incomeRowsLinked;
    } catch (e) {
      summary.errors.push(`upsert ${r.region}/${r.month}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`[Apple finance] user=${userId} reports=${summary.reportsFound} created=${summary.payoutsCreated} updated=${summary.payoutsUpdated} linked=${summary.rowsLinked} errors=${summary.errors.length}`);
  return summary;
}

type FinanceFetchResult =
  | { kind: 'ok'; rows: FinanceRow[] }
  | { kind: 'no_sales' }
  | { kind: 'error'; status: number; body: string };

interface FinanceRow {
  partnerShare: number;
  partnerShareCurrency: string;
  extendedPartnerShare: number;
  units: number;
  countryCode: string;
  productIdentifier: string;
  startDate: string;
  endDate: string;
}

async function fetchFinanceReport(
  jwt: string, vendorNumber: string, regionCode: string, reportDate: string,
): Promise<FinanceFetchResult> {
  const url = `https://api.appstoreconnect.apple.com/v1/financeReports?filter[regionCode]=${regionCode}&filter[reportDate]=${reportDate}&filter[reportType]=FINANCIAL&filter[vendorNumber]=${vendorNumber}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/a-gzip' },
    });
  } catch (e) {
    return { kind: 'error', status: 0, body: e instanceof Error ? e.message : 'fetch threw' };
  }

  if (response.status === 404) {
    // "There were no sales for the date specified." — expected for sub-threshold months.
    return { kind: 'no_sales' };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { kind: 'error', status: response.status, body: body.replace(/\s+/g, ' ') };
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

  const rows = parseFinanceTsv(text);
  return { kind: 'ok', rows };
}

/**
 * The true settlement window, taken from the report's own row dates.
 *
 * Apple writes these as MM/DD/YYYY and every row in a given report carries the
 * same fiscal window, but we take min(start)/max(end) so a mixed report still
 * yields a covering range. Returns nulls when the dates are absent/unparseable
 * so the caller can fall back to the requested month.
 */
function fiscalPeriodFromRows(rows: FinanceRow[]): { start: string | null; end: string | null } {
  const toIso = (v: string | undefined): string | null => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v || '').trim());
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v || '').trim());
    return iso ? iso[0] : null;
  };
  const starts = rows.map((r) => toIso(r.startDate)).filter((v): v is string => !!v).sort();
  const ends = rows.map((r) => toIso(r.endDate)).filter((v): v is string => !!v).sort();
  return { start: starts[0] ?? null, end: ends.length ? ends[ends.length - 1] : null };
}

function parseFinanceTsv(text: string): FinanceRow[] {
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('Total'));
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map((h) => h.trim());
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => { idx[h] = i; });

  const aliases = {
    units: ['Units', 'Quantity'],
    partnerShare: ['Partner Share', 'Developer Proceeds'],
    extendedPartnerShare: ['Extended Partner Share'],
    partnerShareCurrency: ['Partner Share Currency', 'Currency of Proceeds'],
    countryCode: ['Country Of Sale', 'Country Code'],
    productIdentifier: ['Apple Identifier', 'SKU', 'Title'],
    startDate: ['Start Date', 'Begin Date'],
    endDate: ['End Date'],
  };
  const pick = (cols: string[], names: string[]) => {
    for (const n of names) {
      const i = idx[n];
      if (i !== undefined && cols[i] !== undefined) return cols[i];
    }
    return '';
  };

  const rows: FinanceRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const units = parseFloat(pick(cols, aliases.units));
    const partnerShare = parseFloat(pick(cols, aliases.partnerShare));
    const extendedPartnerShare = parseFloat(pick(cols, aliases.extendedPartnerShare));
    if (!Number.isFinite(partnerShare) && !Number.isFinite(extendedPartnerShare)) continue;
    rows.push({
      units: Number.isFinite(units) ? units : 0,
      partnerShare: Number.isFinite(partnerShare) ? partnerShare : 0,
      extendedPartnerShare: Number.isFinite(extendedPartnerShare) ? extendedPartnerShare : partnerShare * units,
      partnerShareCurrency: pick(cols, aliases.partnerShareCurrency) || 'USD',
      countryCode: pick(cols, aliases.countryCode),
      productIdentifier: pick(cols, aliases.productIdentifier),
      startDate: pick(cols, aliases.startDate),
      endDate: pick(cols, aliases.endDate),
    });
  }
  return rows;
}

async function upsertPayoutFromFinanceReport(
  env: Env, userId: string, integrationId: string,
  regionCode: string, reportDate: string, rows: FinanceRow[],
): Promise<{ created: boolean; incomeRowsLinked: number }> {
  // Aggregate by currency (a region report can mix currencies in rare cases).
  const byCurrency: Record<string, number> = {};
  let totalUnits = 0;
  for (const r of rows) {
    const ccy = (r.partnerShareCurrency || 'USD').toUpperCase();
    // LED-40: honor ISO 4217 minor-unit exponent per currency.
    const localCents = toMinorUnits(r.extendedPartnerShare, ccy);
    byCurrency[ccy] = (byCurrency[ccy] || 0) + localCents;
    totalUnits += r.units || 0;
  }

  const currencies = Object.keys(byCurrency);
  if (currencies.length === 0) return { created: false, incomeRowsLinked: 0 };
  const localCurrency = currencies.length === 1 ? currencies[0] : 'USD';

  // Period bounds come from the report's own fiscal dates, NOT the calendar
  // month we queried. Apple's financeReports reportDate is a FISCAL period:
  // reportDate=2026-06 covers 2026-03-01..2026-03-28 and 2026-07 covers
  // 2026-03-29..2026-05-02. Tagging those as June/July mislabelled the payout
  // by ~3 months and — because income rows are linked by
  // transaction_date BETWEEN period_start AND period_end — attached the wrong
  // income to the payout. The requested reportDate is kept in metadata.
  const fiscal = fiscalPeriodFromRows(rows);
  const [fy, fm] = reportDate.split('-').map((s) => parseInt(s, 10));
  const fallbackEnd = new Date(Date.UTC(fy, fm, 0));
  const periodStart = fiscal.start || `${reportDate}-01`;
  const periodEnd = fiscal.end || fallbackEnd.toISOString().slice(0, 10);
  const periodEndDate = new Date(`${periodEnd}T00:00:00Z`);
  const paidDate = new Date(periodEndDate.getTime() + FINANCE_PAYOUT_DELAY_DAYS * 86400_000)
    .toISOString().slice(0, 10);

  // Sum to USD across mixed currencies, if any.
  let totalUsdCents = 0;
  for (const [ccy, cents] of Object.entries(byCurrency)) {
    const usd = await convertToUsdCents(env, cents, ccy, periodEnd);
    if (usd) totalUsdCents += usd.usdCents;
  }
  const localAmountCents = localCurrency === 'USD' ? totalUsdCents : byCurrency[localCurrency];

  // Idempotent on (source, source_payout_id).
  const sourcePayoutId = `apple_finance_${regionCode}_${reportDate}`;

  // Check whether we already have a row: this region's own prior row, or a
  // still-'predicted' row for the same period that this settlement supersedes.
  //
  // The period fallback MUST NOT match another region's already-'paid' row.
  // Apple issues one finance report per settlement region, and every region
  // for a given reportDate produced identical period bounds, so an unscoped
  // period match made each region UPDATE the previous region's row in place —
  // only the last region processed survived (ZA, last in SETTLEMENT_REGIONS),
  // silently discarding every other region's settlement. Scoping to
  // status='predicted' keeps the supersede behaviour without the clobber.
  // user_id is now applied to both branches (it previously only guarded the
  // period branch, so a source_payout_id match could cross tenants).
  const existing = await env.DB.prepare(
    `SELECT id, status FROM payouts
     WHERE source = 'apple_app_store' AND user_id = ?
       AND (source_payout_id = ?
            OR (status = 'predicted' AND period_start = ? AND period_end = ?))
     ORDER BY CASE WHEN source_payout_id = ? THEN 0 ELSE 1 END LIMIT 1`
  ).bind(userId, sourcePayoutId, periodStart, periodEnd, sourcePayoutId).first<{ id: string; status: string }>();

  let payoutId: string;
  let created = false;
  if (existing) {
    payoutId = existing.id;
    await env.DB.prepare(
      `UPDATE payouts SET
         status = 'paid',
         source_payout_id = ?,
         amount_local_cents = ?,
         currency = ?,
         amount_usd_cents = ?,
         paid_date = ?,
         period_start = ?,
         period_end = ?,
         metadata = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      sourcePayoutId, localAmountCents, localCurrency, totalUsdCents,
      paidDate, periodStart, periodEnd,
      JSON.stringify({
        region_code: regionCode,
        report_date: reportDate,
        fiscal_period: { start: periodStart, end: periodEnd },
        currencies: byCurrency,
        units: totalUnits,
        row_count: rows.length,
        source: 'apple_finance_report',
      }),
      payoutId,
    ).run();
  } else {
    payoutId = generateId('payout');
    created = true;
    await env.DB.prepare(
      `INSERT INTO payouts
       (id, user_id, integration_id, source, source_payout_id, status,
        amount_local_cents, currency, amount_usd_cents,
        period_start, period_end, paid_date, metadata)
       VALUES (?, ?, ?, 'apple_app_store', ?, 'paid', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      payoutId, userId, integrationId, sourcePayoutId,
      localAmountCents, localCurrency, totalUsdCents,
      periodStart, periodEnd, paidDate,
      JSON.stringify({
        region_code: regionCode,
        report_date: reportDate,
        fiscal_period: { start: periodStart, end: periodEnd },
        currencies: byCurrency,
        units: totalUnits,
        row_count: rows.length,
        source: 'apple_finance_report',
      }),
    ).run();
  }

  // Supersede reconcile's ESTIMATE for this window. reconcile.ts synthesises a
  // per-calendar-month payout (source_payout_id '<source>_<period>_predicted')
  // from income rows and the grace-period path later flips it to 'paid'. Once
  // Apple's own finance report lands, both describe the SAME money — leaving
  // the estimate 'paid' alongside the settlement double-counts revenue in the
  // YTD-Paid tile. Real settlement wins; the estimate is marked 'superseded',
  // a status no dashboard tile sums, so it drops out of the totals without
  // destroying the record.
  await env.DB.prepare(
    `UPDATE payouts
        SET status = 'superseded', updated_at = datetime('now')
      WHERE user_id = ? AND source = 'apple_app_store'
        AND source_payout_id LIKE '%_predicted'
        AND status IN ('predicted', 'paid')
        AND period_start <= ? AND period_end >= ?`
  ).bind(userId, periodEnd, periodStart).run();

  // Link the matching income rows (those whose transaction_date falls in
  // the report period and are still pending/settled to this user).
  const linkResult = await env.DB.prepare(
    `UPDATE income_transactions
     SET status = 'paid', payout_id = ?, updated_at = datetime('now')
     WHERE user_id = ? AND source = 'apple_app_store'
       AND transaction_date >= ? AND transaction_date <= ?
       AND (status != 'paid' OR payout_id IS NULL OR payout_id != ?)`
  ).bind(payoutId, userId, periodStart, periodEnd, payoutId).run();

  return { created, incomeRowsLinked: linkResult.meta?.changes || 0 };
}
