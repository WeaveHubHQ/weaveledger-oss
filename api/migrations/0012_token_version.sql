-- Add token_version to users for session invalidation on password change / MFA toggle
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
