import { Env } from '../types';

interface Subscription {
  amount: number;
  currency: string;
  plan_interval: string;
  plan_interval_count: number;
  current_period_end: string;
  trial_end_at: string | null;
  cancel_at: string | null;
  status: string;
}

interface ForecastPeriod {
  month: string;
  expected_revenue_cents: number;
  subscription_count: number;
  renewals: number;
}

// Normalize any subscription amount to monthly cents
export function normalizeToMonthlyCents(amount: number, interval: string, intervalCount: number): number {
  switch (interval) {
    case 'month': return Math.round(amount / intervalCount);
    case 'year': return Math.round(amount / (intervalCount * 12));
    case 'week': return Math.round(amount * (52 / 12) / intervalCount);
    case 'day': return Math.round(amount * (365 / 12) / intervalCount);
    default: return amount;
  }
}

// Get the next renewal date after a given date, based on the subscription's billing cycle
function getNextRenewal(periodEnd: Date, interval: string, count: number, afterDate: Date): Date {
  const d = new Date(periodEnd);
  // Walk forward from current_period_end until we pass afterDate
  while (d <= afterDate) {
    if (interval === 'month') d.setMonth(d.getMonth() + count);
    else if (interval === 'year') d.setFullYear(d.getFullYear() + count);
    else if (interval === 'week') d.setDate(d.getDate() + 7 * count);
    else d.setDate(d.getDate() + count);
  }
  return d;
}

// Check if a renewal falls within a given month
function getRenewalsInMonth(
  periodEnd: Date, interval: string, count: number,
  monthStart: Date, monthEnd: Date
): number {
  let renewals = 0;
  const d = new Date(periodEnd);

  // Walk backward to find the earliest possible renewal before monthStart
  while (d > monthStart) {
    if (interval === 'month') d.setMonth(d.getMonth() - count);
    else if (interval === 'year') d.setFullYear(d.getFullYear() - count);
    else if (interval === 'week') d.setDate(d.getDate() - 7 * count);
    else d.setDate(d.getDate() - count);
  }

  // Walk forward counting renewals in window
  while (d <= monthEnd) {
    if (d >= monthStart && d <= monthEnd) renewals++;
    if (interval === 'month') d.setMonth(d.getMonth() + count);
    else if (interval === 'year') d.setFullYear(d.getFullYear() + count);
    else if (interval === 'week') d.setDate(d.getDate() + 7 * count);
    else d.setDate(d.getDate() + count);
  }

  return renewals;
}

export async function computeForecast(
  env: Env, userId: string, months: number
): Promise<{ periods: ForecastPeriod[]; mrr_cents: number; arr_cents: number }> {
  const subs = await env.DB.prepare(
    `SELECT amount, currency, plan_interval, plan_interval_count,
            current_period_end, trial_end_at, cancel_at, status
     FROM subscriptions
     WHERE user_id = ? AND status IN ('active', 'trialing', 'past_due')
     ORDER BY current_period_end`
  ).bind(userId).all<Subscription>();

  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Compute MRR from currently active subs (exclude trialing that haven't converted)
  let mrrCents = 0;
  for (const sub of subs.results) {
    if (sub.status === 'trialing' && sub.trial_end_at && sub.trial_end_at > today) continue;
    if (sub.cancel_at && sub.cancel_at <= today) continue;
    mrrCents += normalizeToMonthlyCents(sub.amount, sub.plan_interval, sub.plan_interval_count);
  }

  // Generate month-by-month forecast
  const periods: ForecastPeriod[] = [];

  for (let i = 0; i < months; i++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = monthDate;
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0); // last day

    let revenue = 0;
    let subCount = 0;
    let totalRenewals = 0;

    for (const sub of subs.results) {
      // Skip if canceled before this month
      if (sub.cancel_at && sub.cancel_at < monthStr + '-01') continue;

      // Skip if still trialing during this month
      if (sub.status === 'trialing' && sub.trial_end_at && sub.trial_end_at > monthEnd.toISOString().split('T')[0]) continue;

      const periodEnd = new Date(sub.current_period_end);
      const renewals = getRenewalsInMonth(periodEnd, sub.plan_interval, sub.plan_interval_count, monthStart, monthEnd);

      if (renewals > 0) {
        revenue += sub.amount * renewals;
        subCount++;
        totalRenewals += renewals;
      }
    }

    periods.push({
      month: monthStr,
      expected_revenue_cents: revenue,
      subscription_count: subCount,
      renewals: totalRenewals,
    });
  }

  return { periods, mrr_cents: mrrCents, arr_cents: mrrCents * 12 };
}

export async function computeSubscriptionSummary(env: Env, userId: string) {
  const active = await env.DB.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_cents,
            source, plan_interval, plan_interval_count
     FROM subscriptions WHERE user_id = ? AND status IN ('active', 'trialing')
     GROUP BY source`
  ).bind(userId).all<{ count: number; total_cents: number; source: string; plan_interval: string; plan_interval_count: number }>();

  const churned = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM subscriptions
     WHERE user_id = ? AND canceled_at >= date('now', '-30 days')`
  ).bind(userId).first<{ count: number }>();

  let mrrCents = 0;
  let activeCount = 0;
  const bySource: Array<{ source: string; count: number; mrr_cents: number }> = [];

  // Need individual subs for proper MRR calculation
  const allActive = await env.DB.prepare(
    `SELECT amount, plan_interval, plan_interval_count, source
     FROM subscriptions WHERE user_id = ? AND status IN ('active', 'trialing')`
  ).bind(userId).all<{ amount: number; plan_interval: string; plan_interval_count: number; source: string }>();

  const sourceMap = new Map<string, { count: number; mrr: number }>();

  for (const sub of allActive.results) {
    activeCount++;
    const monthly = normalizeToMonthlyCents(sub.amount, sub.plan_interval, sub.plan_interval_count);
    mrrCents += monthly;

    const existing = sourceMap.get(sub.source) || { count: 0, mrr: 0 };
    existing.count++;
    existing.mrr += monthly;
    sourceMap.set(sub.source, existing);
  }

  for (const [source, data] of sourceMap) {
    bySource.push({ source, count: data.count, mrr_cents: data.mrr });
  }

  return {
    mrr_cents: mrrCents,
    arr_cents: mrrCents * 12,
    active_count: activeCount,
    churned_30d: churned?.count || 0,
    by_source: bySource,
  };
}
