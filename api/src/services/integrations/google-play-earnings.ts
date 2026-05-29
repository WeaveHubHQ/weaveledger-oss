import { Env } from '../../types';
import { generateId } from '../../utils/crypto';
import { convertToUsdCents } from '../../utils/fx';
import { toMinorUnits } from '../../utils/currency';

/**
 * LED-39 (fees): Google Play earnings reports sync.
 *
 * Source of truth for actual platform fees per transaction. RTDN tells us
 * what a subscription state is; it doesn't say what Google's commission was.
 * The monthly earnings ZIP in
 *   gs://pubsite_prod_rev_<developer_account_id>/earnings/earnings_YYYYMM.zip
 * contains a CSV with per-transaction columns including:
 *   - Charged Amount (customer-paid, gross)
 *   - Service Fee Amount (Google's actual commission for that transaction)
 *   - Buyer Currency / Merchant Currency
 *   - Tax Type / Buyer Tax Amount
 *   - Order Number (joins to our source_transaction_id = "gp_<order>")
 *
 * Authoritative for fees — no hardcoded 15% / 30% guessing. Works correctly
 * for above-threshold developers (30%) AND Small Business Program (15%)
 * because we read what Google actually charged, not what we think they
 * charged.
 *
 * Free: the bucket is Google-managed; Google covers access cost.
 *
 * One-time setup the user has to do (we can't do it from a Worker):
 *   gsutil iam ch \
 *     serviceAccount:<existing-play-service-account>:objectViewer \
 *     gs://pubsite_prod_rev_<account_id>
 *
 * The developer_account_id field on the integration credentials tells us
 * which bucket to read. If absent, this sync is skipped with a clear log
 * message — we don't fail the daily cron.
 */

interface GooglePlayEarningsCredentials {
  client_email: string;
  private_key: string;
  package_name: string;
  developer_account_id?: string;  // LED-39: required for earnings sync
}

const LOOKBACK_MONTHS = 6;

export interface EarningsSyncSummary {
  reportsFetched: number;
  rowsUpserted: number;
  errors: string[];
}

export async function syncGooglePlayEarnings(
  env: Env,
  userId: string,
  integrationId: string,
  credentials: GooglePlayEarningsCredentials,
): Promise<EarningsSyncSummary> {
  const summary: EarningsSyncSummary = { reportsFetched: 0, rowsUpserted: 0, errors: [] };

  if (!credentials.developer_account_id) {
    console.log('[GP earnings] No developer_account_id on integration — skip (add it to enable real fee tracking)');
    return summary;
  }

  let accessToken: string;
  try {
    accessToken = await getGcsAccessToken(credentials);
  } catch (e) {
    summary.errors.push(`gcs auth: ${e instanceof Error ? e.message : String(e)}`);
    return summary;
  }

  const bucket = `pubsite_prod_rev_${credentials.developer_account_id}`;
  const now = new Date();
  const months: string[] = [];
  for (let i = 1; i <= LOOKBACK_MONTHS; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  for (const ym of months) {
    try {
      const objects = await listEarningsObjects(bucket, ym, accessToken);
      for (const obj of objects) {
        try {
          const csv = await downloadAndUnzip(bucket, obj.name, accessToken);
          if (!csv) continue;
          summary.reportsFetched++;
          const upserted = await applyEarningsCsv(env, userId, integrationId, csv, ym);
          summary.rowsUpserted += upserted;
        } catch (e) {
          summary.errors.push(`${obj.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      // 404 on the list endpoint means no earnings yet for that month — silent.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/404|no earnings/i.test(msg)) {
        summary.errors.push(`${ym} list: ${msg.slice(0, 200)}`);
      }
    }
  }

  console.log(`[GP earnings] user=${userId} reports=${summary.reportsFetched} upserts=${summary.rowsUpserted} errors=${summary.errors.length}`);
  return summary;
}

/**
 * Mint a GCS-scoped OAuth token from the existing service account key.
 * Different scope than the Play API token, so we generate a fresh JWT here.
 */
async function getGcsAccessToken(creds: GooglePlayEarningsCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_only',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const encode = (obj: unknown) => btoa(JSON.stringify(obj))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
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

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GCS OAuth: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json<{ access_token: string }>();
  return data.access_token;
}

async function listEarningsObjects(
  bucket: string, yearMonth: string, accessToken: string,
): Promise<Array<{ name: string }>> {
  // Earnings filenames vary slightly by region/account; use prefix match.
  // Examples: "earnings/earnings_202604.zip", "salesreports/earnings_202604.zip"
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=earnings/earnings_${yearMonth}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return [];
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`list ${bucket}: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json<{ items?: Array<{ name: string }> }>();
  return data.items || [];
}

async function downloadAndUnzip(
  bucket: string, objectName: string, accessToken: string,
): Promise<string | null> {
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectName)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`download ${objectName}: ${res.status} ${body.slice(0, 200)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return await extractFirstCsvFromZip(buf);
}

/**
 * Minimal single-file ZIP reader. Google Play earnings ZIPs contain a single
 * CSV; we don't need full ZIP-archive support. Reads the first Local File
 * Header (PK\x03\x04), pipes the deflated payload through Workers' built-in
 * deflate-raw decompressor. Falls back to STORE (no compression) if needed.
 */
async function extractFirstCsvFromZip(buf: Uint8Array): Promise<string | null> {
  // Local File Header signature: 0x04034b50 (little-endian: PK\x03\x04)
  if (buf.length < 30 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    throw new Error('not a ZIP file');
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const compressionMethod = dv.getUint16(8, true);   // 0=store, 8=deflate
  const compressedSize = dv.getUint32(18, true);
  const filenameLen = dv.getUint16(26, true);
  const extraLen = dv.getUint16(28, true);
  const dataStart = 30 + filenameLen + extraLen;
  // ZIP allows compressed_size=0xFFFFFFFF for streaming; we don't handle that case.
  if (compressedSize === 0xFFFFFFFF) {
    throw new Error('ZIP uses zip64 streaming size — unsupported');
  }
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return new TextDecoder().decode(compressed);
  }
  if (compressionMethod !== 8) {
    throw new Error(`unsupported ZIP compression method: ${compressionMethod}`);
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(out);
}

/**
 * Parse the earnings CSV and upsert into income_transactions. Match on
 * source_transaction_id = `gp_<Order Number>`. Earnings overwrite any
 * RTDN-derived row for the same order — earnings IS the authoritative
 * fee data.
 */
async function applyEarningsCsv(
  env: Env, userId: string, integrationId: string, csv: string, yearMonth: string,
): Promise<number> {
  const lines = csv.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return 0;

  // CSV with quoted fields. Use a simple splitter that handles quotes.
  const parseCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        out.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  };

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => { idx[h] = i; });

  const get = (cols: string[], names: string[]): string => {
    for (const n of names) {
      const i = idx[n];
      if (i !== undefined && cols[i] !== undefined) return cols[i].trim();
    }
    return '';
  };

  const aliases = {
    description: ['Description', 'Item Description'],
    transactionDate: ['Transaction Date', 'Order Charged Timestamp'],
    transactionType: ['Transaction Type', 'Type'],
    refundType: ['Refund Type'],
    orderNumber: ['Order Number'],
    productId: ['Product ID', 'Sku Id'],
    productTitle: ['Product Title'],
    skuId: ['Sku Id', 'Product ID'],
    chargedBuyerAmount: ['Charged Amount', "Buyer's Total Charged"],
    buyerCurrency: ["Buyer Currency", 'Buyer’s Currency'],
    merchantCurrency: ['Merchant Currency'],
    chargedMerchantAmount: ['Amount (Merchant Currency)', 'Charged Amount (Merchant Currency)'],
    feeMerchantAmount: ['Service Fee Amount', 'Amount (Service Fee)'],
    countryCode: ['Buyer Country', 'Country of Buyer'],
  };

  let upserts = 0;
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r]);
    if (cols.length === 1 && cols[0] === '') continue;

    const orderNumber = get(cols, aliases.orderNumber);
    if (!orderNumber) continue;

    const transactionType = get(cols, aliases.transactionType).toLowerCase();
    const isRefund = /refund|chargeback/.test(transactionType);

    const buyerCurrency = (get(cols, aliases.buyerCurrency) || 'USD').toUpperCase();
    const merchantCurrency = (get(cols, aliases.merchantCurrency) || buyerCurrency).toUpperCase();
    const grossBuyer = parseAmount(get(cols, aliases.chargedBuyerAmount));
    if (grossBuyer === null) continue;
    const grossMerchant = parseAmount(get(cols, aliases.chargedMerchantAmount)) ?? grossBuyer;
    const feeMerchant = parseAmount(get(cols, aliases.feeMerchantAmount)) ?? 0;

    // Sign: refunds appear as negative amounts in earnings; preserve sign.
    // LED-40: honor ISO 4217 minor-unit exponent per currency. Zero-decimal
    // currencies (JPY, KRW, …) stay as-is; 2-decimal multiplies by 100.
    const sign = isRefund ? (grossBuyer >= 0 ? -1 : 1) : 1;
    const grossBuyerCents = toMinorUnits(Math.abs(grossBuyer), buyerCurrency) * sign;
    const grossMerchantCents = toMinorUnits(Math.abs(grossMerchant), merchantCurrency) * sign;
    const feeMerchantCents = toMinorUnits(Math.abs(feeMerchant), merchantCurrency) * sign;
    const netMerchantCents = grossMerchantCents - feeMerchantCents;

    const txnDate = parseDate(get(cols, aliases.transactionDate)) || `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-01`;
    const productId = get(cols, aliases.productId) || get(cols, aliases.skuId);
    const productTitle = get(cols, aliases.productTitle) || productId;
    const description = get(cols, aliases.description) || `Google Play: ${productTitle}`;

    const txnId = isRefund ? `gp_refund_${orderNumber}` : `gp_${orderNumber}`;

    // FX both legs to USD. Buyer currency for gross/fee, merchant for net.
    const usdGross = await convertToUsdCents(env, grossBuyerCents, buyerCurrency, txnDate);
    const usdNet = await convertToUsdCents(env, netMerchantCents, merchantCurrency, txnDate);
    const usdFee = (usdGross && usdNet) ? (usdGross.usdCents - usdNet.usdCents) : null;

    const id = generateId('inc');
    await env.DB.prepare(
      `INSERT INTO income_transactions
       (id, user_id, integration_id, source, source_transaction_id,
        amount, currency, net_amount, fee_amount,
        transaction_date, description, product_name, metadata,
        usd_amount_cents, fx_rate, fx_rate_date, status,
        gross_amount, gross_currency, usd_gross_cents, usd_fee_cents)
       VALUES (?, ?, ?, 'google_play', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
       ON CONFLICT(source, source_transaction_id) DO UPDATE SET
         amount = excluded.amount,
         currency = excluded.currency,
         net_amount = excluded.net_amount,
         fee_amount = excluded.fee_amount,
         description = excluded.description,
         product_name = excluded.product_name,
         metadata = json_patch(COALESCE(income_transactions.metadata, '{}'), excluded.metadata),
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
      grossBuyerCents, buyerCurrency, netMerchantCents,
      merchantCurrency === buyerCurrency ? feeMerchantCents : null,
      txnDate, description, productTitle,
      JSON.stringify({
        order_number: orderNumber,
        transaction_type: transactionType,
        merchant_currency: merchantCurrency,
        merchant_gross_cents: grossMerchantCents,
        merchant_fee_cents: feeMerchantCents,
        merchant_net_cents: netMerchantCents,
        report_month: yearMonth,
        source_report: 'google_play_earnings',
      }),
      usdGross?.usdCents ?? null, usdGross?.rate ?? null, usdGross?.rateDate ?? null,
      grossBuyerCents, buyerCurrency,
      usdGross?.usdCents ?? null, usdFee,
    ).run();
    upserts++;
  }
  return upserts;
}

function parseAmount(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[",$\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(s: string): string | null {
  if (!s) return null;
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}
