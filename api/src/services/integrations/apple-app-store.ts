import { Env } from '../../types';
import { generateId } from '../../utils/crypto';
import { getAppleJWT } from '../../utils/apple-jws';

interface AppleCredentials {
  issuer_id: string;
  key_id: string;
  private_key: string;
  vendor_number: string;
}

export async function syncAppleAppStore(
  env: Env, userId: string, integrationId: string, credentials: AppleCredentials, lastSyncAt: string | null
): Promise<{ synced: number; errors: string[] }> {
  let synced = 0;
  const errors: string[] = [];

  try {
    const jwt = await getAppleJWT(credentials);

    // Determine which months to fetch (current and previous)
    const now = new Date();
    const months: string[] = [];
    months.push(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    months.push(`${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`);

    for (const reportDate of months) {
      const url = `https://api.appstoreconnect.apple.com/v1/financeReports?filter[regionCode]=ZZ&filter[reportDate]=${reportDate}&filter[reportType]=FINANCIAL&filter[vendorNumber]=${credentials.vendor_number}`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/a-gzip' },
      });

      if (!response.ok) {
        if (response.status === 404) continue; // Report not yet available
        const err = await response.text();
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
      if (lines.length < 2) continue;

      const headers = lines[0].split('\t');
      const colMap: Record<string, number> = {};
      headers.forEach((h, i) => { colMap[h.trim()] = i; });

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        const startDate = cols[colMap['Start Date']] || cols[colMap['Begin Date']] || reportDate;
        const productId = cols[colMap['Apple Identifier']] || cols[colMap['SKU']] || '';
        const productName = cols[colMap['Title']] || cols[colMap['Product Type Identifier']] || '';
        const units = parseFloat(cols[colMap['Units']] || '0');
        const proceeds = parseFloat(cols[colMap['Developer Proceeds']] || cols[colMap['Extended Partner Share']] || '0');
        const currency = cols[colMap['Currency of Proceeds']] || cols[colMap['Partner Share Currency']] || 'USD';

        if (units <= 0 || proceeds <= 0) continue;

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
        } catch {
          // UNIQUE constraint
        }
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Unknown Apple API error');
  }

  return { synced, errors };
}
