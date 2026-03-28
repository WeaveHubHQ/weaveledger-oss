-- Subscription tracking for anticipated revenue forecasting
-- Tracks active recurring subscriptions from Stripe and Google Play

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id         TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,

  -- Provider identification
  source                 TEXT NOT NULL CHECK (source IN ('stripe', 'google_play', 'apple_app_store')),
  source_subscription_id TEXT NOT NULL,

  -- Product / plan info
  product_id             TEXT,
  product_name           TEXT,
  plan_interval          TEXT NOT NULL CHECK (plan_interval IN ('day', 'week', 'month', 'year')),
  plan_interval_count    INTEGER NOT NULL DEFAULT 1,

  -- Monetary values (integer cents)
  amount                 INTEGER NOT NULL,
  currency               TEXT NOT NULL DEFAULT 'USD',

  -- Lifecycle
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused', 'expired')),
  started_at             TEXT NOT NULL,
  trial_end_at           TEXT,
  current_period_start   TEXT NOT NULL,
  current_period_end     TEXT NOT NULL,
  canceled_at            TEXT,
  cancel_at              TEXT,

  -- Metadata
  customer_id            TEXT,
  metadata               TEXT,

  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(source, source_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions(current_period_end);
