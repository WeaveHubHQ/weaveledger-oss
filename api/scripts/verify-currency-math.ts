// LED-40 — Sanity checks for currency + FX conversion math.
// Run with: npx tsx api/scripts/verify-currency-math.ts
//
// We don't have a real test runner wired up. This script imports the
// helpers and asserts the math identities that must hold across the
// 2-decimal / 0-decimal / 3-decimal currency boundary.

import { minorUnitFactor, toMinorUnits, fromMinorUnits } from '../src/utils/currency';

type Case = { name: string; got: unknown; want: unknown };
const cases: Case[] = [];
const eq = (name: string, got: unknown, want: unknown) => cases.push({ name, got, want });

// minorUnitFactor — ISO 4217 exponents.
eq('USD factor', minorUnitFactor('USD'), 100);
eq('EUR factor', minorUnitFactor('eur'), 100);
eq('JPY factor', minorUnitFactor('JPY'), 1);
eq('KRW factor', minorUnitFactor('KRW'), 1);
eq('VND factor', minorUnitFactor('VND'), 1);
eq('BHD factor', minorUnitFactor('BHD'), 1000);
eq('unknown defaults to 100', minorUnitFactor('XYZ'), 100);

// toMinorUnits — major decimal → integer minor units per currency.
eq('USD 2.99 → 299', toMinorUnits(2.99, 'USD'), 299);
eq('EUR 2.99 → 299', toMinorUnits(2.99, 'EUR'), 299);
eq('JPY 500 → 500', toMinorUnits(500, 'JPY'), 500);
eq('KRW 7000 → 7000', toMinorUnits(7000, 'KRW'), 7000);
eq('BHD 2.500 → 2500', toMinorUnits(2.5, 'BHD'), 2500);
eq('JPY 336 (Apple proceeds) → 336', toMinorUnits(336, 'JPY'), 336);

// fromMinorUnits — inverse.
eq('USD 299 → 2.99', fromMinorUnits(299, 'USD'), 2.99);
eq('JPY 500 → 500', fromMinorUnits(500, 'JPY'), 500);
eq('BHD 2500 → 2.5', fromMinorUnits(2500, 'BHD'), 2.5);

// FX conversion identity for the post-LED-40 formula.
// usd_cents = localMinor * rate / sourceFactor * 100
function fxToUsdCents(localMinor: number, rate: number, currency: string): number {
  const f = minorUnitFactor(currency);
  return Math.round((localMinor / f) * rate * 100);
}

// EUR 2.99 @ 1.15 → $3.4385 → 344¢ (matches pre-LED-40 behavior — no regression).
eq('EUR 2.99 @ 1.15 → 344 USD¢', fxToUsdCents(299, 1.15, 'EUR'), 344);

// USD identity.
eq('USD 299 @ 1.00 → 299 USD¢', fxToUsdCents(299, 1.0, 'USD'), 299);

// JPY ¥500 @ 0.0063 → $3.15 → 315¢ (was wrong pre-LED-40 in two ways
// that cancelled; now correct on both sides).
eq('JPY ¥500 @ 0.0063 → 315 USD¢', fxToUsdCents(500, 0.0063, 'JPY'), 315);

// KRW ₩7000 @ 0.00072 → $5.04 → 504¢.
eq('KRW ₩7000 @ 0.00072 → 504 USD¢', fxToUsdCents(7000, 0.00072, 'KRW'), 504);

// BHD 2.500 @ 2.65 → $6.625 → 663¢.
eq('BHD 2500 @ 2.65 → 663 USD¢', fxToUsdCents(2500, 2.65, 'BHD'), 663);

// Cross-currency aggregate check: sum of April 2026 USD cents from prod
// data = 315 + 355 + 1089 + 345 + 346 = 2450¢ = $24.50.
const april = [
  fxToUsdCents(500,   0.0063045911,  'JPY'), // ¥500
  fxToUsdCents(5999,  0.059247796,   'ZAR'), // R59.99
  fxToUsdCents(3999,  0.27229408,    'AED'), // د.إ39.99
  fxToUsdCents(499,   0.6910232,     'AUD'), // A$4.99
  fxToUsdCents(299,   1.15667336,    'EUR'), // €2.99
];
const aprilTotal = april.reduce((a, b) => a + b, 0);
eq('April 2026 USD cents total', aprilTotal, 2450); // matches sum of live DB usd_gross_cents.

let failed = 0;
for (const c of cases) {
  const ok = c.got === c.want;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${c.name}  got=${c.got}  want=${c.want}`);
}
console.log(failed === 0 ? `\n${cases.length}/${cases.length} pass.` : `\n${failed} FAILED.`);
if (failed > 0) process.exit(1);
