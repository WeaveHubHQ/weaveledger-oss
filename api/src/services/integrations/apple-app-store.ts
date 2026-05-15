import { Env } from '../../types';
import { generateId } from '../../utils/crypto';
import { getAppleJWT } from '../../utils/apple-jws';

interface AppleCredentials {
  issuer_id: string;
  key_id: string;
  private_key: string;
  vendor_number: string;
}

// LED-31 lookback: Apple pays ~33-45 days after fiscal month-end, so the
// payment a user sees on day N of month M usually corresponds to fiscal month
// M-2 (or earlier). A 2-month window misses that report entirely. Pull the
// trailing 4 calendar months so we always cover the most recent payable.
const APPLE_LOOKBACK_MONTHS = 4;

// Column names vary across Apple's Financial Report variants. We accept the
// canonical names AND the older / alternate spellings.
const COLUMN_ALIASES: Record<string, string[]> = {
  startDate: ['Start Date', 'Begin Date'],
  productId: ['Apple Identifier', 'SKU'],
  productName: ['Title', 'Product Type Identifier'],
  units: ['Quantity', 'Units'],
  proceeds: ['Developer Proceeds', 'Extended Partner Share', 'Partner Share'],
  currency: ['Currency of Proceeds', 'Partner Share Currency'],
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

    // Build 4-month lookback list.
    const now = new Date();
    const months: string[] = [];
    for (let i = 0; i < APPLE_LOOKBACK_MONTHS; i++) {
      const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }

    for (const reportDate of months) {
      const url = `https://api.appstoreconnect.apple.com/v1/financeReports?filter[regionCode]=ZZ&filter[reportDate]=${reportDate}&filter[reportType]=FINANCIAL&filter[vendorNumber]=${credentials.vendor_number}`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/a-gzip' },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[Apple sync] ${reportDate}: 404 (not published yet)`);
          continue;
        }
        const err = await response.text();
        // Apple returns 500 for not-yet-available reports too — log and move on.
        errors.push(`Apple API error for ${reportDate}: ${response.status} ${err.slice(0, 200)}`);
        continue;
      }

      // Response is gzip-compressed TSV
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
        // Maybe not gzipped
        text = new TextDecoder().decode(blob);
      }

      // Parse TSV
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) {
        console.log(`[Apple sync] ${reportDate}: empty report (${lines.length} lines)`);
        continue;
      }

      const headers = lines[0].split('\t').map(h => h.trim());
      const colMap: Record<string, number> = {};
      headers.forEach((h, i) => { colMap[h] = i; });

      // Log headers + size on first sight per month so column-mismatch issues
      // are diagnosable from wrangler tail / Workers Logs without redeploying.
      console.log(`[Apple sync] ${reportDate}: ${lines.length - 1} data row(s), headers=[${headers.join('|')}]`);

      let rowsThisMonth = 0;
      let skippedThisMonth = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        const startDate = pickColumn(cols, colMap, COLUMN_ALIASES.startDate) || reportDate;
        const productId = pickColumn(cols, colMap, COLUMN_ALIASES.productId);
        const productName = pickColumn(cols, colMap, COLUMN_ALIASES.productName);
        const unitsRaw = pickColumn(cols, colMap, COLUMN_ALIASES.units);
        const proceedsRaw = pickColumn(cols, colMap, COLUMN_ALIASES.proceeds);
        const currency = pickColumn(cols, colMap, COLUMN_ALIASES.currency) || 'USD';

        const units = parseFloat(unitsRaw);
        const proceeds = parseFloat(proceedsRaw);

        // NaN-safe guard: only accept finite positive values. parseFloat('')
        // returns NaN, and `NaN <= 0` is `false`, so the old guard let NaN
        // rows fall through and INSERT NaN amounts.
        if (!Number.isFinite(units) || units <= 0 ||
            !Number.isFinite(proceeds) || proceeds <= 0) {
          skippedThisMonth++;
          continue;
        }

        const txnId = `apple_${reportDate}_${productId}_${i}`;
        const amount = Math.round(proceeds * 100);

        try {
          const id = generateId('inc');
          await env.DB.prepare(
            `INSERT OR IGNORE INTO income_transactions
             (id, user_id, integration_id, source, source_transaction_id, amount, currency, net_amount, transaction_date, description, product_name, metadata)
             VALUES (?, ?, ?, 'apple_app_store', ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            id, userId, integrationId, txnId,
            amount, currency.toUpperCase(), amount,
            startDate,
            `App Store: ${productName || productId}`,
            productName || productId,
            JSON.stringify({ units, proceeds, product_id: productId, report_date: reportDate })
          ).run();
          synced++;
          rowsThisMonth++;
        } catch (e) {
          console.error(`[Apple sync] ${reportDate} row ${i} INSERT failed:`, e);
        }
      }

      console.log(`[Apple sync] ${reportDate}: synced ${rowsThisMonth}, skipped ${skippedThisMonth}`);
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Unknown Apple API error');
  }

  return { synced, errors };
}
