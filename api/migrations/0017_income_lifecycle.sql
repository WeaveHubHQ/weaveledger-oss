-- LED-33: Income lifecycle — status column + payout linkage + USD normalization.
--
-- Status transitions: 'pending' (default for new rows) → 'settled' (provider
-- has finalized the reporting period) → 'paid' (linked to a paid payout).
-- A refund creates a NEW negative-amount row, also 'settled'/'paid', linked
-- via metadata to the original — we never UPDATE the original row's amount.
--
-- usd_amount_cents lets us aggregate across mixed currencies. Captured at
-- INSERT time using the current FX rate. The rate + rate date are persisted
-- for audit and re-computation.

ALTER TABLE income_transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE income_transactions ADD COLUMN payout_id TEXT;
ALTER TABLE income_transactions ADD COLUMN usd_amount_cents INTEGER;
ALTER TABLE income_transactions ADD COLUMN fx_rate REAL;
ALTER TABLE income_transactions ADD COLUMN fx_rate_date TEXT;

CREATE INDEX IF NOT EXISTS idx_income_transactions_status
  ON income_transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_income_transactions_payout
  ON income_transactions(payout_id);

-- FX rates cache. We fetch from exchangerate.host once per day per currency
-- pair, store here, and reuse for the rest of the day. Fallback path: if the
-- external API is unreachable, the most-recent cached rate is used.
CREATE TABLE IF NOT EXISTS fx_rates_cache (
  id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL DEFAULT 'USD',
  rate_date TEXT NOT NULL,    -- YYYY-MM-DD
  rate REAL NOT NULL,         -- multiplier: amount_in_from × rate = amount_in_to
  source TEXT NOT NULL,       -- 'exchangerate.host' | 'manual' | 'fallback'
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_currency, to_currency, rate_date)
);
CREATE INDEX IF NOT EXISTS idx_fx_rates_cache_lookup
  ON fx_rates_cache(from_currency, to_currency, rate_date DESC);
