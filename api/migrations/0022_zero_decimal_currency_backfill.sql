-- LED-40 — Zero-decimal currency backfill.
--
-- Pre-LED-40 importers (Apple sales, Apple finance reports, Google Play
-- earnings) did `Math.round(amount * 100)` for every currency, ignoring
-- that JPY/KRW/VND/etc. don't have minor units. Result: ¥500 stored as
-- 50000 in income_transactions.amount and gross_amount.
--
-- USD-converted columns (usd_gross_cents, usd_amount_cents, usd_fee_cents)
-- were accidentally correct because convertToUsdCents made an inverse
-- error that cancelled out. Local-amount columns were not corrected and
-- inflate PnL/tax aggregates that read raw `amount`.
--
-- Scope (per code review):
--   * Only source IN ('apple_app_store', 'google_play'). Stripe's API
--     already returns true minor units, so Stripe JPY rows would be
--     correct — must not be divided. Manual entries: same.
--   * Only single-currency rows: currency = gross_currency. This is
--     required because Apple/Google can store gross in one currency and
--     net in another. When they differ, fee_amount is NULL and the legs
--     live in different currencies; this migration's blanket /100 on
--     net_amount/fee_amount would corrupt the dollar-denominated leg.
--   * Magnitude gate: amount % 100 = 0 AND |amount| >= 100. Belt-and-
--     suspenders against a hypothetical row already in true minor units
--     that coincidentally happens to be a multiple of 100 ≥ 100 (e.g. a
--     newly-synced ¥10000 row arriving between deploy and migration).
--     The combination of (source + single-currency + zero-decimal +
--     mod-100 + magnitude) makes such a false-positive vanishingly
--     unlikely. D1 migrations are once-only, so re-execution risk is
--     limited to manual re-runs.
--
-- The ISO 4217 zero-decimal set we apply this to is the same list used
-- by src/utils/currency.ts (`ZERO_DECIMAL`). Keep them in sync if
-- expanded.

UPDATE income_transactions
SET amount = amount / 100,
    gross_amount = CASE
      WHEN gross_amount IS NOT NULL THEN gross_amount / 100
      ELSE gross_amount
    END,
    net_amount = CASE
      WHEN net_amount IS NOT NULL THEN net_amount / 100
      ELSE net_amount
    END,
    fee_amount = CASE
      WHEN fee_amount IS NOT NULL THEN fee_amount / 100
      ELSE fee_amount
    END,
    updated_at = datetime('now')
WHERE source IN ('apple_app_store', 'google_play')
  AND currency IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF')
  AND (gross_currency IS NULL OR gross_currency = currency)
  AND amount % 100 = 0
  AND ABS(amount) >= 100;
