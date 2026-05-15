-- LED-39: cron observability + admin reconciliation
-- An auditable record of every scheduled run so silent failures are caught
-- within hours instead of a billing cycle later.

CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  cron_name TEXT NOT NULL,
  cron_schedule TEXT,
  trigger TEXT NOT NULL DEFAULT 'cron',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  rows_settled INTEGER DEFAULT 0,
  payouts_created INTEGER DEFAULT 0,
  users_processed INTEGER DEFAULT 0,
  error_message TEXT,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(cron_name, started_at DESC);
