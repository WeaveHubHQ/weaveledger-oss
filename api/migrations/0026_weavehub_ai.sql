-- Per-user WeaveHub AI key (encrypted with the same per-user scheme as the
-- other provider keys). Selecting ai_provider='weavehub' routes receipt
-- extraction through ai.weavehub.app with this key.
ALTER TABLE users ADD COLUMN weavehub_ai_key TEXT;
