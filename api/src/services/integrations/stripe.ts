import { Env } from '../../types';
import { generateId } from '../../utils/crypto';

interface StripeBalanceTransaction {
  id: string;
  amount: number;
  currency: string;
  fee: number;
  net: number;
  created: number;
  description: string | null;
  type: string;
  reporting_category: string;
  source: string | null;
}

interface StripeListResponse {
  data: StripeBalanceTransaction[];
  has_more: boolean;
}

export async function syncStripe(
  env: Env, userId: string, integrationId: string, apiKey: string, lastSyncAt: string | null
): Promise<{ synced: number; errors: string[] }> {
  let synced = 0;
  const errors: string[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  // Only fetch income-related transactions (charges, payouts)
  const createdFilter = lastSyncAt
    ? `&created[gte]=${Math.floor(new Date(lastSyncAt).getTime() / 1000)}`
    : '';

  while (hasMore) {
    const url = `https://api.stripe.com/v1/balance_transactions?limit=100&type=charge${createdFilter}${startingAfter ? `&starting_after=${startingAfter}` : ''}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const err = await response.text();
      errors.push(`Stripe API error: ${response.status} ${err.slice(0, 200)}`);
      break;
    }

    const data = await response.json<StripeListResponse>();

    for (const txn of data.data) {
      try {
        const id = generateId('inc');
        await env.DB.prepare(
          `INSERT OR IGNORE INTO income_transactions
           (id, user_id, integration_id, source, source_transaction_id, amount, currency, net_amount, fee_amount, transaction_date, description, metadata)
           VALUES (?, ?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id, userId, integrationId, txn.id,
          txn.amount, txn.currency.toUpperCase(),
          txn.net, txn.fee,
          new Date(txn.created * 1000).toISOString().split('T')[0],
          txn.description,
          JSON.stringify({ type: txn.type, reporting_category: txn.reporting_category, source: txn.source })
        ).run();
        synced++;
      } catch (e) {
        // UNIQUE constraint = already synced, skip
      }
    }

    hasMore = data.has_more;
    if (data.data.length > 0) {
      startingAfter = data.data[data.data.length - 1].id;
    } else {
      hasMore = false;
    }
  }

  return { synced, errors };
}
