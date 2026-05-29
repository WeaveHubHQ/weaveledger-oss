/**
 * LED-40 — Currency minor-unit utilities.
 *
 * ISO 4217 defines a minor-unit exponent per currency. USD/EUR/AUD/etc. use
 * 2 (1 dollar = 100 cents). JPY/KRW/VND/etc. are zero-decimal (1 yen = 1 yen,
 * no sub-units). A few currencies use 3 (e.g. BHD, JOD, KWD).
 *
 * Historically the codebase treated every currency as 2-decimal: importers
 * did `Math.round(amount * 100)` regardless of currency, so ¥500 was stored
 * as 50000 "cents" in `income_transactions.amount`. That produced wrong
 * PnL/tax aggregates and a misleading local-currency value (though the
 * USD conversion accidentally cancelled out because the FX function also
 * assumed factor=100).
 *
 * The two functions below centralize the correct conversion. They are the
 * only places that should know about minor-unit exponents.
 */

// ISO 4217 zero-decimal currencies. Source: ISO 4217:2015 + cldr.
const ZERO_DECIMAL: ReadonlySet<string> = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

// ISO 4217 three-decimal currencies. Stripe/Apple/Google all also follow
// these. Listed for completeness; uncommon in our user base.
const THREE_DECIMAL: ReadonlySet<string> = new Set([
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
]);

/**
 * Number of minor units per major unit (the multiplier you'd apply to a
 * decimal amount to get an integer minor-unit count). For USD/EUR: 100. For
 * JPY/KRW: 1. For BHD: 1000.
 */
export function minorUnitFactor(currency: string): number {
  const upper = (currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL.has(upper)) return 1;
  if (THREE_DECIMAL.has(upper)) return 1000;
  return 100;
}

/**
 * Convert a decimal/major-unit amount (e.g. 2.99 EUR, 500 JPY) to an integer
 * minor-unit count per the currency's actual exponent. Use this in importers
 * that receive decimal values from TSV/CSV/JSON.
 */
export function toMinorUnits(majorAmount: number, currency: string): number {
  return Math.round(majorAmount * minorUnitFactor(currency));
}

/**
 * Convert a minor-unit integer back to a major-unit decimal. Inverse of
 * `toMinorUnits`.
 */
export function fromMinorUnits(minorAmount: number, currency: string): number {
  return minorAmount / minorUnitFactor(currency);
}
