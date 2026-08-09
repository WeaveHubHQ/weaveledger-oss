-- Per-user default book for inbound email receipts. When set (and still owned +
-- open), inbound email routes here; otherwise the handler falls back to the
-- oldest open book. Nullable: NULL means "use the oldest-open fallback".
ALTER TABLE users ADD COLUMN default_book_id TEXT;
