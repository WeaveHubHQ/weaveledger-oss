-- Phase H1: 'awaiting_credits' receipt status.
--
-- Trigger: a receipt showed status='failed', "Unknown Merchant", and a wall of raw
-- provider JSON when both the WeaveHub AI gateway and the Anthropic fallback were out
-- of credits. Running out of credits is temporary and self-correcting; the pipeline
-- should not present it identically to a genuinely unreadable image. This migration
-- adds the status value the H2 cron sweep will use to retry these receipts once
-- credits return.
--
-- receipts.status has a CHECK constraint (see 0001_initial.sql) so SQLite requires a
-- full table rebuild to widen it, per the precedent in 0014_fix_environment_check.sql.
--
-- ** DO NOT copy 0014's DROP-then-RENAME shape for this table. ** receipts has four
-- dependents -- line_items.receipt_id, receipt_tags.receipt_id,
-- expense_report_items.receipt_id (all ON DELETE CASCADE), and
-- statement_transactions.matched_receipt_id (ON DELETE SET NULL). D1 enforces foreign
-- keys at the connection level (PRAGMA foreign_keys reports 1; this is not something
-- any statement in this repo turns on or off), so a plain `DROP TABLE receipts`
-- performs an implicit delete of every row that still has children, which CASCADEs
-- and destroys them. `PRAGMA defer_foreign_keys` does not help -- it only postpones
-- *reporting* an FK violation, it does not suppress the CASCADE action itself. This
-- was verified empirically against a schema-accurate scratch database (real DROP,
-- real FK enforcement on, real child rows in all four tables): the naive
-- create/copy/drop/rename shape used for app_subscriptions in 0014 deletes every
-- line_items, receipt_tags, and expense_report_items row belonging to a receipt, and
-- nulls out every statement_transactions.matched_receipt_id pointing at one.
-- app_subscriptions has no dependents; receipts does, so 0014 is not a safe precedent
-- here.
--
-- The approach below avoids the problem at its root instead of trying to suppress FK
-- enforcement: it never issues a DROP or DELETE against a row that still has a live
-- reference pointing at it.
--
--   1. Build receipts_new (widened CHECK) and copy every row across, under the old,
--      still-untouched `receipts` table. Nothing has been removed yet.
--   2. Build a `_new` copy of each of the four dependent tables, with their foreign
--      key pointed at receipts_new instead of receipts, and copy their rows across.
--      At this point the OLD and NEW receipts/child tables are full duplicates of
--      each other; nothing has been deleted.
--   3. Drop the OLD child tables. This is safe under any FK enforcement setting --
--      nothing references line_items, receipt_tags, expense_report_items, or
--      statement_transactions, so dropping them triggers no CASCADE.
--   4. Drop the OLD receipts table. By this point it has zero live children (they
--      were dropped in step 3, and the `_new` children reference receipts_new, not
--      receipts), so this DROP triggers no CASCADE either.
--   5. Rename every `_new` table into its final name. Renaming receipts_new to
--      receipts causes SQLite to automatically rewrite the `_new` children's foreign
--      key definitions from `REFERENCES receipts_new(id)` to `REFERENCES
--      receipts(id)` -- verified via the child tables' resulting `.schema` output.
--
-- This was verified end-to-end against a schema-accurate scratch database seeded with
-- a receipt plus one row in each of the four dependent tables (including a non-NULL
-- statement_transactions.matched_receipt_id): all four child rows, and the match
-- link, survive the migration, and `PRAGMA foreign_key_check` reports zero violations
-- afterward. See api/scripts/verify-awaiting-credits-migration.ts for the equivalent
-- committed, runnable check (child-row survival is the assertion; a migration test
-- without child rows proves nothing here, which is exactly how the original,
-- lossy version of this file passed local testing).
--
-- No explicit BEGIN/COMMIT here: D1 does not expose transaction control
-- over its remote HTTP API, and this would have been the only one of 32
-- migrations to use it. (An earlier comment claimed wrangler REJECTS such a
-- file with "contains several transactions" -- that was checked and is not
-- true; the wrapper applies fine locally. It was dropped for consistency and
-- because the remote path was never exercised, not because it errors.)

-- Step 1: new receipts table, widened CHECK, temp name. Old `receipts` untouched.
CREATE TABLE receipts_new (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  merchant TEXT,
  amount REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  date TEXT,
  category TEXT,
  subcategory TEXT,
  description TEXT,
  payment_method TEXT,
  tax_amount REAL,
  tip_amount REAL,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('camera', 'email', 'manual', 'upload')),
  image_key TEXT,
  raw_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'awaiting_credits')),
  ai_confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  attachments TEXT,
  receipt_number TEXT,
  invoice_number TEXT,
  tax_deductible INTEGER DEFAULT 0,
  tax_category TEXT,
  ai_error_detail TEXT
);

INSERT INTO receipts_new (
  id, book_id, user_id, merchant, amount, currency, date, category, subcategory,
  description, payment_method, tax_amount, tip_amount, notes, source, image_key,
  raw_email, status, ai_confidence, created_at, updated_at, attachments,
  receipt_number, invoice_number, tax_deductible, tax_category
)
SELECT
  id, book_id, user_id, merchant, amount, currency, date, category, subcategory,
  description, payment_method, tax_amount, tip_amount, notes, source, image_key,
  raw_email, status, ai_confidence, created_at, updated_at, attachments,
  receipt_number, invoice_number, tax_deductible, tax_category
FROM receipts;

-- Step 2: `_new` copies of every dependent table, FK pointed at receipts_new.
CREATE TABLE line_items_new (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts_new(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  total REAL NOT NULL
);
INSERT INTO line_items_new (id, receipt_id, description, quantity, unit_price, total)
SELECT id, receipt_id, description, quantity, unit_price, total FROM line_items;

CREATE TABLE receipt_tags_new (
  receipt_id TEXT NOT NULL REFERENCES receipts_new(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (receipt_id, tag_id)
);
INSERT INTO receipt_tags_new (receipt_id, tag_id)
SELECT receipt_id, tag_id FROM receipt_tags;

CREATE TABLE expense_report_items_new (
  report_id TEXT NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL REFERENCES receipts_new(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (report_id, receipt_id)
);
INSERT INTO expense_report_items_new (report_id, receipt_id, added_at)
SELECT report_id, receipt_id, added_at FROM expense_report_items;

CREATE TABLE statement_transactions_new (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  fitid TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'suggested', 'confirmed', 'ignored')),
  matched_receipt_id TEXT REFERENCES receipts_new(id) ON DELETE SET NULL,
  match_confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO statement_transactions_new (
  id, statement_id, book_id, date, description, amount, currency, fitid,
  match_status, matched_receipt_id, match_confidence, created_at
)
SELECT
  id, statement_id, book_id, date, description, amount, currency, fitid,
  match_status, matched_receipt_id, match_confidence, created_at
FROM statement_transactions;

-- Step 3: drop the OLD child tables. Nothing references them; no CASCADE fires.
DROP TABLE line_items;
DROP TABLE receipt_tags;
DROP TABLE expense_report_items;
DROP TABLE statement_transactions;

-- Step 4: drop the OLD receipts table. It has zero live children left; no CASCADE.
DROP TABLE receipts;

-- Step 5: rename everything into its final place.
ALTER TABLE receipts_new RENAME TO receipts;
ALTER TABLE line_items_new RENAME TO line_items;
ALTER TABLE receipt_tags_new RENAME TO receipt_tags;
ALTER TABLE expense_report_items_new RENAME TO expense_report_items;
ALTER TABLE statement_transactions_new RENAME TO statement_transactions;

CREATE INDEX idx_receipts_book_id ON receipts(book_id);
CREATE INDEX idx_receipts_user_id ON receipts(user_id);
CREATE INDEX idx_receipts_date ON receipts(date);
CREATE INDEX idx_receipts_category ON receipts(category);
CREATE INDEX idx_receipts_status ON receipts(status);
CREATE INDEX idx_receipts_merchant ON receipts(merchant);

CREATE INDEX idx_line_items_receipt_id ON line_items(receipt_id);

CREATE INDEX idx_expense_report_items_receipt ON expense_report_items(receipt_id);

CREATE INDEX idx_stmt_txns_statement ON statement_transactions(statement_id);
CREATE INDEX idx_stmt_txns_book_status ON statement_transactions(book_id, match_status);
CREATE INDEX idx_stmt_txns_receipt ON statement_transactions(matched_receipt_id);
CREATE INDEX idx_stmt_txns_book_fitid ON statement_transactions(book_id, fitid);
