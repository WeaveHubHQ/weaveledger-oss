-- WeaveHub AI as a selectable provider. users.ai_provider has a CHECK
-- constraint limited to ('anthropic','openai') and rebuilding users on D1 is
-- unsafe (child tables hold FKs to it; DROP TABLE would fire FK actions), so
-- the choice is stored as a flag instead: when set, the effective provider is
-- 'weavehub' and ai_provider retains the BYO fallback preference.
ALTER TABLE users ADD COLUMN weavehub_ai_enabled INTEGER NOT NULL DEFAULT 0;
