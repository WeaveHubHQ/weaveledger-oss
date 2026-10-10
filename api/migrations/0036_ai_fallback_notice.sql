-- Set while a user's primary AI provider is out of credits and a fallback
-- provider is handling their scans. Drives a plain-language notice in
-- Settings; cleared when the primary provider succeeds again.
ALTER TABLE users ADD COLUMN ai_fallback_since TEXT;
ALTER TABLE users ADD COLUMN ai_fallback_provider TEXT;
