-- Income tracking: integrations and transactions
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'google_play', 'apple_app_store')),
  credentials TEXT NOT NULL,  -- AES-GCM encrypted JSON
  is_active INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS income_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('stripe', 'google_play', 'apple_app_store')),
  source_transaction_id TEXT NOT NULL,
  amount INTEGER NOT NULL,         -- in smallest currency unit (cents)
  currency TEXT NOT NULL DEFAULT 'USD',
  net_amount INTEGER,              -- after fees
  fee_amount INTEGER,
  transaction_date TEXT NOT NULL,
  description TEXT,
  customer_email TEXT,
  product_name TEXT,
  metadata TEXT,                   -- JSON blob of original record
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_income_user ON income_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_income_date ON income_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_income_source ON income_transactions(source);
CREATE INDEX IF NOT EXISTS idx_income_book ON income_transactions(book_id);
