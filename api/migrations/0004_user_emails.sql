-- Additional email addresses for receipt capture
-- Users can register multiple email addresses so receipts sent from any of them are attributed correctly

CREATE TABLE IF NOT EXISTS user_emails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  verification_code TEXT,
  verification_expires TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_emails_email ON user_emails(email);
CREATE INDEX IF NOT EXISTS idx_user_emails_user_id ON user_emails(user_id);
