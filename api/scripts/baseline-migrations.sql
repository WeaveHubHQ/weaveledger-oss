-- One-time baseline for databases that predate the wrangler D1 migrations
-- system (migrations were previously applied ad-hoc via `d1 execute`).
--
-- Marks every migration through 0023 as already applied WITHOUT running it,
-- so `wrangler d1 migrations apply DB --remote` (now part of `npm run
-- deploy`) only runs migrations added after this baseline.
--
-- Run once against an EXISTING production database:
--   npm run db:baseline
--
-- Do NOT run against a fresh database — just run `npm run db:migrate`
-- there, which applies everything from 0001 and records it itself.
--
-- Table schema matches what wrangler creates on first `migrations apply`.

CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0001_initial.sql'),
  ('0002_mfa.sql'),
  ('0003_roles_invitations.sql'),
  ('0004_user_emails.sql'),
  ('0005_attachments.sql'),
  ('0006_ai_provider_receipt_numbers.sql'),
  ('0007_user_api_keys.sql'),
  ('0008_income_tracking.sql'),
  ('0009_subscriptions.sql'),
  ('0010_account_lockout.sql'),
  ('0011_budgets_tax_recurring.sql'),
  ('0012_token_version.sql'),
  ('0013_app_subscriptions.sql'),
  ('0014_fix_environment_check.sql'),
  ('0015_rejected_email_senders.sql'),
  ('0017_income_lifecycle.sql'),
  ('0018_payouts.sql'),
  ('0019_cron_runs.sql'),
  ('0020_income_updated_at.sql'),
  ('0021_gross_amount.sql'),
  ('0022_zero_decimal_currency_backfill.sql'),
  ('0023_subscription_amount_usd_cents.sql');
