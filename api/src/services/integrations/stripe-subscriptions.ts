import { Env } from '../../types';
import { generateId } from '../../utils/crypto';

interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  currency: string;
  current_period_start: number;
  current_period_end: number;
  start_date: number;
  trial_end: number | null;
  canceled_at: number | null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{
      price: {
        id: string;
        unit_amount: number;
        currency: string;
        nickname: string | null;
        product: string | { name?: string };
        recurring: {
          interval: 'day' | 'week' | 'month' | 'year';
          interval_count: number;
        };
      };
      quantity: number;
    }>;
  };
}

interface StripeListResponse {
  data: StripeSubscription[];
  has_more: boolean;
}

export async function syncStripeSubscriptions(
  env: Env, userId: string, integrationId: string, apiKey: string
): Promise<{ synced: number; updated: number; errors: string[] }> {
  let synced = 0;
  let updated = 0;
  const errors: string[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params = new URLSearchParams({
      limit: '100',
      status: 'all',
      'expand[]': 'data.items.data.price.product',
    });
    if (startingAfter) params.set('starting_after', startingAfter);

    const response = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const err = await response.text();
      errors.push(`Stripe subscriptions API error: ${response.status} ${err.slice(0, 200)}`);
      break;
    }

    const data = await response.json<StripeListResponse>();

    for (const sub of data.data) {
      const item = sub.items.data[0];
      if (!item) continue;

      const price = item.price;
      const productName = typeof price.product === 'object' ? price.product.name : price.nickname;
      const amount = price.unit_amount * (item.quantity || 1);
      const toISO = (ts: number) => new Date(ts * 1000).toISOString().split('T')[0];

      // Map Stripe status to our status enum
      let status = sub.status;
      if (status === 'incomplete' || status === 'incomplete_expired') status = 'expired';

      // If cancel_at_period_end is true, treat as still active but with a cancel_at date
      const cancelAt = sub.cancel_at ? toISO(sub.cancel_at)
        : sub.cancel_at_period_end ? toISO(sub.current_period_end)
        : null;

      try {
        const id = generateId('sub');
        const result = await env.DB.prepare(
          `INSERT INTO subscriptions
           (id, user_id, integration_id, source, source_subscription_id, product_id, product_name,
            plan_interval, plan_interval_count, amount, currency, status, started_at,
            trial_end_at, current_period_start, current_period_end, canceled_at, cancel_at, customer_id, metadata)
           VALUES (?, ?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source, source_subscription_id) DO UPDATE SET
             status = excluded.status,
             amount = excluded.amount,
             current_period_start = excluded.current_period_start,
             current_period_end = excluded.current_period_end,
             canceled_at = excluded.canceled_at,
             cancel_at = excluded.cancel_at,
             product_name = excluded.product_name,
             updated_at = datetime('now')`
        ).bind(
          id, userId, integrationId, sub.id,
          price.id, productName || null,
          price.recurring.interval, price.recurring.interval_count,
          amount, price.currency.toUpperCase(),
          status, toISO(sub.start_date),
          sub.trial_end ? toISO(sub.trial_end) : null,
          toISO(sub.current_period_start), toISO(sub.current_period_end),
          sub.canceled_at ? toISO(sub.canceled_at) : null,
          cancelAt,
          sub.customer,
          JSON.stringify({ id: sub.id, customer: sub.customer })
        ).run();

        if (result.meta.changes > 0) {
          // Check if it was an insert or update
          const existing = await env.DB.prepare(
            'SELECT id FROM subscriptions WHERE source = ? AND source_subscription_id = ? AND id != ?'
          ).bind('stripe', sub.id, id).first();
          if (existing) updated++;
          else synced++;
        }
      } catch (e) {
        // Already tracked via ON CONFLICT
        updated++;
      }
    }

    hasMore = data.has_more;
    if (data.data.length > 0) {
      startingAfter = data.data[data.data.length - 1].id;
    } else {
      hasMore = false;
    }
  }

  return { synced, updated, errors };
}
