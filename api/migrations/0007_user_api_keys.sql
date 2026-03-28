-- Encrypted API keys per user (AES-GCM encrypted with JWT_SECRET)
ALTER TABLE users ADD COLUMN anthropic_api_key TEXT;
ALTER TABLE users ADD COLUMN openai_api_key TEXT;
