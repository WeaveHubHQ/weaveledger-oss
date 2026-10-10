-- LED-27: Idempotent webhook event log.
--
-- Keyed by (source, event_id) so duplicate deliveries from any webhook
-- provider (RevenueCat now, future providers later) are de-duped at insert
-- time via the unique index. The receiving route checks if the row already
-- exists; if yes, it returns 200 immediately without re-processing.
--
-- Payload retained for forensics — RevenueCat redrives sometimes carry
-- additional context, and we want to be able to reconstruct what happened
-- without going back to the provider.

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  process_status TEXT,
  process_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_source_event
  ON webhook_events(source, event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received
  ON webhook_events(received_at);
