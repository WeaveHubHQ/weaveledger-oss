-- LED-39 followup: income_transactions needs updated_at for status transitions
-- (settle, mark-paid, refund-link). Backfilled to created_at on existing rows.

ALTER TABLE income_transactions ADD COLUMN updated_at TEXT;
UPDATE income_transactions SET updated_at = COALESCE(created_at, datetime('now'));
