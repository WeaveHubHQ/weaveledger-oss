-- LED-33: Payouts table.
--
-- One row per actual or predicted bank deposit from Apple / Google Play /
-- Stripe / etc. Status transitions: 'predicted' (created by the monthly
-- reconciliation cron) → 'paid' (user confirmed via Mark Received OR Stripe
-- payout API returned status=paid).
--
-- amount_local_cents is the payout in the wire currency (e.g., 4191 USD cents
-- = $41.91). amount_usd_cents is the FX-converted estimate (or the actual
-- USD when paid from a USD payout). period_start..period_end is inclusive..
-- exclusive — the sales window this payout covers.

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  source TEXT NOT NULL,                  -- 'apple_app_store' | 'google_play' | 'stripe'
  source_payout_id TEXT,                 -- provider's payout id (Stripe payout.id); auto-generated for predicted Apple/Google payouts
  status TEXT NOT NULL DEFAULT 'predicted',  -- 'predicted' | 'pending' | 'paid' | 'failed'
  amount_local_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  amount_usd_cents INTEGER,
  fx_rate REAL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  predicted_date TEXT,
  paid_date TEXT,
  bank_reference TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_payout_id)
);

CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_payouts_date ON payouts(user_id, paid_date DESC);
