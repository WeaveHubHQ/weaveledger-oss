import { Env } from '../types';
import { generateId } from './crypto';
import { minorUnitFactor } from './currency';

/**
 * LED-33 — Currency conversion helper.
 *
 * Approach:
 *  1. Look up rate in D1 cache (fx_rates_cache) for (from, to, date).
 *  2. If cache miss, fetch from the fawazahmed0 currency-api (free, no key,
 *     CDN-served, historical dates supported), store in cache, return.
 *  3. If the external API is unreachable, fall back to the most recent
 *     cached rate for that pair regardless of date.
 *  4. If no cached rate at all (cold start, network broken), return null and
 *     let the caller decide (we don't fabricate rates — better to leave
 *     usd_amount_cents null than to mislead).
 *
 * currency-api: pages.dev mirror of fawazahmed0/exchange-api. ~200 currencies
 * (fiat + crypto), daily ECB-based rates, historical snapshots via
 * <date>.currency-api.pages.dev. No rate limit observed; CDN-cached.
 *
 * Historical pattern: https://<YYYY-MM-DD>.currency-api.pages.dev/v1/currencies/<from>.json
 * Latest pattern:     https://latest.currency-api.pages.dev/v1/currencies/<from>.json
 */

const CURRENCY_API_PRIMARY = 'currency-api.pages.dev';
// Fallback in case the pages.dev mirror is down. jsdelivr serves the same data.
const CURRENCY_API_FALLBACK_PREFIX = 'https://cdn.jsdelivr.net/gh/fawazahmed0/exchange-api';

/** USD has trivial FX with itself; short-circuit. */
function isSameCurrency(from: string, to: string): boolean {
  return from.toUpperCase() === to.toUpperCase();
}

/**
 * Get the FX rate from `from` currency to `to` currency for a given date
 * (YYYY-MM-DD). Returns null if no rate can be obtained.
 */
export async function getFxRate(
  env: Env,
  from: string,
  to: string = 'USD',
  date?: string,
): Promise<{ rate: number; rateDate: string; source: string } | null> {
  if (!from) return null;
  const fromCcy = from.toUpperCase();
  const toCcy = to.toUpperCase();
  if (isSameCurrency(fromCcy, toCcy)) {
    return { rate: 1, rateDate: date || today(), source: 'identity' };
  }

  const lookupDate = date || today();

  // 1. Try cache for the exact (pair, date).
  const cached = await env.DB.prepare(
    `SELECT rate, rate_date, source FROM fx_rates_cache
     WHERE from_currency = ? AND to_currency = ? AND rate_date = ?
     LIMIT 1`
  ).bind(fromCcy, toCcy, lookupDate).first<{ rate: number; rate_date: string; source: string }>();

  if (cached) {
    return { rate: cached.rate, rateDate: cached.rate_date, source: cached.source };
  }

  // 2. Fetch live. currency-api uses YYYY-MM-DD as the subdomain for
  // historical snapshots, or `latest` for today. We always use the dated
  // form when a date is provided so multi-month backfills get accurate
  // historical rates, not today's rate.
  const dateSubdomain = lookupDate === today() ? 'latest' : lookupDate;
  const fromLower = fromCcy.toLowerCase();
  const toLower = toCcy.toLowerCase();
  const urls = [
    `https://${dateSubdomain}.${CURRENCY_API_PRIMARY}/v1/currencies/${fromLower}.json`,
    `${CURRENCY_API_FALLBACK_PREFIX}@${dateSubdomain === 'latest' ? 'latest' : dateSubdomain}/v1/currencies/${fromLower}.json`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) continue;
      const body = await res.json<Record<string, unknown>>();
      const rates = body[fromLower] as Record<string, number> | undefined;
      const rate = rates?.[toLower];
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        await storeRate(env, fromCcy, toCcy, lookupDate, rate, 'currency-api');
        return { rate, rateDate: lookupDate, source: 'currency-api' };
      }
    } catch (e) {
      console.warn(`[FX] currency-api fetch threw for ${url}:`, e);
    }
  }
  console.warn(`[FX] No live rate for ${fromCcy}->${toCcy} on ${lookupDate}`);

  // 3. Fall back to the most recent cached rate for this pair regardless of date.
  const fallback = await env.DB.prepare(
    `SELECT rate, rate_date FROM fx_rates_cache
     WHERE from_currency = ? AND to_currency = ?
     ORDER BY rate_date DESC LIMIT 1`
  ).bind(fromCcy, toCcy).first<{ rate: number; rate_date: string }>();

  if (fallback) {
    console.warn(`[FX] Using stale cached rate for ${fromCcy}->${toCcy} from ${fallback.rate_date}`);
    return { rate: fallback.rate, rateDate: fallback.rate_date, source: 'cache_fallback' };
  }

  // 4. No rate available.
  return null;
}

/**
 * Convert a local-currency minor-unit amount to USD cents using the FX
 * helper. Returns `{ usdCents, rate, rateDate }` or null if no rate
 * available.
 *
 * LED-40 — `localMinorUnits` is in the source currency's true minor units
 * per ISO 4217 (¥500 = 500, $2.99 = 299, JD2.500 = 2500). The FX rate is
 * major-to-major (1 source = X USD), so we normalize through major units
 * to USD cents using `minorUnitFactor(currency)`. This is correct for
 * zero-decimal currencies (JPY, KRW, …) where the previous "multiply by
 * the rate directly" formula undershot by 100×.
 *
 * Caller is responsible for storing rate + rateDate alongside the row for
 * audit; `null` means "we couldn't convert, store local amount only".
 */
export async function convertToUsdCents(
  env: Env,
  localMinorUnits: number,
  fromCurrency: string,
  date?: string,
): Promise<{ usdCents: number; rate: number; rateDate: string; source: string } | null> {
  const rate = await getFxRate(env, fromCurrency, 'USD', date);
  if (!rate) return null;
  const sourceFactor = minorUnitFactor(fromCurrency);
  // major-to-major, then back to USD cents (factor 100).
  const localMajor = localMinorUnits / sourceFactor;
  const usdMajor = localMajor * rate.rate;
  return {
    usdCents: Math.round(usdMajor * 100),
    rate: rate.rate,
    rateDate: rate.rateDate,
    source: rate.source,
  };
}

async function storeRate(
  env: Env,
  from: string,
  to: string,
  rateDate: string,
  rate: number,
  source: string,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO fx_rates_cache (id, from_currency, to_currency, rate_date, rate, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(generateId('fx'), from, to, rateDate, rate, source).run();
  } catch (e) {
    console.error('[FX] Failed to cache rate:', e);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
