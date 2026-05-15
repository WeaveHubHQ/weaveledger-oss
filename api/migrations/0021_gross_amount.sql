-- LED-39 (fees): track real platform commissions from each source
-- (Apple's Customer Price column, Google's earnings reports, Stripe's fee field).
-- After this migration, the conventions are:
--   amount               = customer-paid cents (gross), in `currency`
--   currency             = customer's local currency
--   net_amount           = developer proceeds cents (post-commission), in `currency`
--   fee_amount           = platform commission cents, in `currency` (amount - net_amount)
--   gross_amount, gross_currency = explicit gross when it differs from
--                                  proceeds currency (Apple's case: customer
--                                  paid JPY, developer settled in USD)
--   usd_amount_cents     = USD-normalized GROSS (renamed semantics)
--   usd_gross_cents      = explicit USD-normalized gross (mirrors usd_amount_cents
--                          for clarity in queries)
--   usd_fee_cents        = USD-normalized platform fee
--
-- Older rows have amount = developer proceeds (pre-LED-39 convention). The
-- LED-39 backfill endpoint re-syncs them so amount = gross going forward.

ALTER TABLE income_transactions ADD COLUMN gross_amount INTEGER;
ALTER TABLE income_transactions ADD COLUMN gross_currency TEXT;
ALTER TABLE income_transactions ADD COLUMN usd_gross_cents INTEGER;
ALTER TABLE income_transactions ADD COLUMN usd_fee_cents INTEGER;

-- Initial backfill: for rows we already know are gross (Stripe stores it that
-- way today), populate the new explicit columns from the existing ones so
-- the dashboard can sum uniformly without per-source branching.
UPDATE income_transactions
SET gross_amount = amount,
    gross_currency = currency,
    usd_gross_cents = usd_amount_cents,
    usd_fee_cents = CASE
      WHEN fee_amount IS NOT NULL AND amount != 0 AND usd_amount_cents IS NOT NULL
        THEN CAST(usd_amount_cents * 1.0 * fee_amount / amount AS INTEGER)
      ELSE NULL
    END
WHERE source = 'stripe';
