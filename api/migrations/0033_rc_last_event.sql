-- RevenueCat webhook ordering guard.
--
-- Webhook deliveries are not ordered: a retried EXPIRATION can arrive after
-- the RENEWAL that superseded it. The handler stamps each user with the
-- event_timestamp_ms of the last event it applied and ignores anything older.

ALTER TABLE users ADD COLUMN rc_last_event_ms INTEGER;
