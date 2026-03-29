-- Remove CHECK constraint on environment column.
-- D1 applied 0013 with CHECK(environment IN ('Sandbox','Production'))
-- but StoreKit testing sends environment='Xcode'.
-- SQLite requires table recreation to drop a CHECK constraint.

CREATE TABLE IF NOT EXISTS app_subscriptions_new (
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

INSERT INTO app_subscriptions_new SELECT * FROM app_subscriptions;

DROP TABLE app_subscriptions;

ALTER TABLE app_subscriptions_new RENAME TO app_subscriptions;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_app_subs_user_id ON app_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_subs_status ON app_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_app_subs_orig_txn ON app_subscriptions(original_transaction_id);
