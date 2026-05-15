import { Env } from '../../types';
import { generateId } from '../../utils/crypto';
import { convertToUsdCents } from '../../utils/fx';

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
        const ccy = txn.currency.toUpperCase();
        const txnDate = new Date(txn.created * 1000).toISOString().split('T')[0];
        // LED-33: USD-normalize. Stripe `net` is the developer-actually-gets
        // amount (after Stripe fees), which is what we want in usd_amount_cents.
        const usd = await convertToUsdCents(env, txn.net, ccy, txnDate);
        if (!usd && txn.net !== 0) {
          console.warn(`[Stripe sync] FX miss: currency=${ccy} date=${txnDate} amount=${txn.net} — usd_amount_cents will be NULL`);
        }

        await env.DB.prepare(
          `INSERT OR IGNORE INTO income_transactions
           (id, user_id, integration_id, source, source_transaction_id, amount, currency, net_amount, fee_amount,
            transaction_date, description, metadata,
            usd_amount_cents, fx_rate, fx_rate_date, status)
           VALUES (?, ?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(
          id, userId, integrationId, txn.id,
          txn.amount, ccy,
          txn.net, txn.fee,
          txnDate,
          txn.description,
          JSON.stringify({ type: txn.type, reporting_category: txn.reporting_category, source: txn.source }),
          usd?.usdCents ?? null,
          usd?.rate ?? null,
          usd?.rateDate ?? null
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

  // LED-35: sync Stripe payouts. Unlike Apple/Google (where LED-34 predicts
  // payouts via a monthly cron), Stripe exposes a real payouts API with
  // confirmed arrival dates and amounts. We can wire status='paid' directly
  // and link the underlying charges via balance_transactions(payout=...).
  try {
    await syncStripePayouts(env, userId, integrationId, apiKey, lastSyncAt);
  } catch (e) {
    errors.push(`Stripe payouts: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  return { synced, errors };
}

interface StripePayout {
  id: string;
  amount: number;          // in smallest currency unit (cents for USD)
  currency: string;
  arrival_date: number;    // unix seconds — the date funds were expected to land in bank
  status: string;          // 'paid' | 'pending' | 'in_transit' | 'canceled' | 'failed'
  type: string;
  description: string | null;
  statement_descriptor: string | null;
}

interface StripePayoutsResponse {
  data: StripePayout[];
  has_more: boolean;
}

async function syncStripePayouts(
  env: Env, userId: string, integrationId: string, apiKey: string, lastSyncAt: string | null,
): Promise<void> {
  // Look back 90 days max (or since last sync, whichever is further back).
  const lookbackSecs = 90 * 86400;
  const sinceSecs = lastSyncAt
    ? Math.min(Math.floor(new Date(lastSyncAt).getTime() / 1000), Math.floor(Date.now() / 1000) - lookbackSecs)
    : Math.floor(Date.now() / 1000) - lookbackSecs;

  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const url = `https://api.stripe.com/v1/payouts?limit=100&status=paid&arrival_date[gte]=${sinceSecs}${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Stripe payouts API error: ${response.status} ${err.slice(0, 200)}`);
    }
    const data = await response.json<StripePayoutsResponse>();

    for (const payout of data.data) {
      try {
        const paidDate = new Date(payout.arrival_date * 1000).toISOString().slice(0, 10);
        const ccy = payout.currency.toUpperCase();
        const usd = await convertToUsdCents(env, payout.amount, ccy, paidDate);
        const payoutId = generateId('payout');

        // Upsert by (source, source_payout_id).
        await env.DB.prepare(
          `INSERT INTO payouts
           (id, user_id, integration_id, source, source_payout_id, status,
            amount_local_cents, currency, amount_usd_cents, fx_rate,
            period_start, period_end, paid_date, metadata)
           VALUES (?, ?, ?, 'stripe', ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source, source_payout_id) DO UPDATE SET
             status = 'paid',
             amount_local_cents = excluded.amount_local_cents,
             amount_usd_cents = excluded.amount_usd_cents,
             fx_rate = excluded.fx_rate,
             paid_date = excluded.paid_date,
             updated_at = datetime('now')`
        ).bind(
          payoutId, userId, integrationId, payout.id,
          payout.amount, ccy, usd?.usdCents ?? null, usd?.rate ?? null,
          paidDate, paidDate, paidDate,
          JSON.stringify({
            type: payout.type,
            description: payout.description,
            statement_descriptor: payout.statement_descriptor,
            arrival_date: payout.arrival_date,
          })
        ).run();

        // Get the row id we actually wrote (insert may have lost to upsert).
        const stored = await env.DB.prepare(
          `SELECT id FROM payouts WHERE source = 'stripe' AND source_payout_id = ?`
        ).bind(payout.id).first<{ id: string }>();
        if (!stored) continue;

        // Link underlying charges: list balance_transactions with payout=<id>.
        await linkStripeChargesToPayout(env, userId, apiKey, payout.id, stored.id);
      } catch (e) {
        console.error(`[Stripe payouts] upsert failed for ${payout.id}:`, e);
      }
    }

    hasMore = data.has_more;
    if (data.data.length > 0) {
      startingAfter = data.data[data.data.length - 1].id;
    } else {
      hasMore = false;
    }
  }
}

async function linkStripeChargesToPayout(
  env: Env, userId: string, apiKey: string, stripePayoutId: string, ourPayoutId: string,
): Promise<void> {
  let hasMore = true;
  let startingAfter: string | undefined;
  while (hasMore) {
    const url = `https://api.stripe.com/v1/balance_transactions?limit=100&payout=${stripePayoutId}&type=charge${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    if (!response.ok) {
      const err = await response.text();
      console.warn(`[Stripe payouts] failed to list charges for payout ${stripePayoutId}: ${response.status} ${err.slice(0, 200)}`);
      return;
    }
    const data = await response.json<{ data: Array<{ id: string }>; has_more: boolean }>();

    if (data.data.length > 0) {
      const chargeIds = data.data.map((t) => t.id);
      const placeholders = chargeIds.map(() => '?').join(',');
      await env.DB.prepare(
        `UPDATE income_transactions
         SET status = 'paid', payout_id = ?, updated_at = datetime('now')
         WHERE user_id = ? AND source = 'stripe' AND source_transaction_id IN (${placeholders})`
      ).bind(ourPayoutId, userId, ...chargeIds).run();
    }

    hasMore = data.has_more;
    if (data.data.length > 0) {
      startingAfter = data.data[data.data.length - 1].id;
    } else {
      hasMore = false;
    }
  }
}
