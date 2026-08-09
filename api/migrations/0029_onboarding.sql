-- Tracks whether a user has seen (finished or skipped) the first-run walkthrough.
ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0;
