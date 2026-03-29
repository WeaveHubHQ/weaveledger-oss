-- App subscription tracking (user's own WeaveLedger subscription, NOT their customers' subscriptions)
CREATE TABLE IF NOT EXISTS app_subscriptions (
  id                        TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_transaction_id   TEXT NOT NULL,
  transaction_id            TEXT,
  product_id                TEXT NOT NULL,
  bundle_id                 TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'expired', 'revoked', 'grace_period', 'billing_retry')),
  expires_at                TEXT NOT NULL,
  renewed_at                TEXT,
  auto_renew_enabled        INTEGER NOT NULL DEFAULT 1,
  canceled_at               TEXT,
  revocation_date           TEXT,
  revocation_reason         INTEGER,
  environment               TEXT NOT NULL DEFAULT 'Production',
  last_notification_type    TEXT,
  last_notification_subtype TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(original_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_app_subs_user_id ON app_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_subs_status ON app_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_app_subs_orig_txn ON app_subscriptions(original_transaction_id);

-- Add subscription tier to users for quick lookups
ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN subscription_expires_at TEXT;

-- Grandfather existing users with 90-day pro access
UPDATE users SET subscription_tier = 'pro', subscription_expires_at = datetime('now', '+90 days') WHERE created_at < datetime('now');

-- D1-backed rate limiting (replaces in-memory Map)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);

-- Refresh tokens for JWT rotation
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(token_hash)
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
