-- LED-26: Persist every inbound email rejected by the worker so future bounces
-- are diagnosable from D1 instead of requiring live `wrangler tail` or asking
-- the user to forward the DSN.
--
-- Populated by api/src/services/email-handler.ts before each setReject() call.

CREATE TABLE IF NOT EXISTS rejected_email_senders (
  id TEXT PRIMARY KEY,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rejected_email_senders_from
  ON rejected_email_senders(from_email);
CREATE INDEX IF NOT EXISTS idx_rejected_email_senders_occurred
  ON rejected_email_senders(occurred_at);
