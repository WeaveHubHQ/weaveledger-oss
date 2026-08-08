-- Bank/credit-card statement import + receipt matching.
-- See docs/statement-matching-spec.md.
--
-- A statement is an imported OFX or CSV file; its transactions are matched
-- against completed receipts in the same book by amount, date proximity,
-- and merchant similarity. Suggestions are confirmed or rejected by the
-- user; unmatched transactions can be converted into manual receipts.

CREATE TABLE IF NOT EXISTS statements (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT,
  format TEXT NOT NULL CHECK (format IN ('ofx', 'csv')),
  account_name TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  period_start TEXT,
  period_end TEXT,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS statement_transactions (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,  -- always positive; imported debits (money out)
  currency TEXT NOT NULL DEFAULT 'USD',
  fitid TEXT,            -- OFX FITID when present, used for dedup on re-import
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'suggested', 'confirmed', 'ignored')),
  matched_receipt_id TEXT REFERENCES receipts(id) ON DELETE SET NULL,
  match_confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_statements_book ON statements(book_id);
CREATE INDEX IF NOT EXISTS idx_stmt_txns_statement ON statement_transactions(statement_id);
CREATE INDEX IF NOT EXISTS idx_stmt_txns_book_status ON statement_transactions(book_id, match_status);
CREATE INDEX IF NOT EXISTS idx_stmt_txns_receipt ON statement_transactions(matched_receipt_id);
CREATE INDEX IF NOT EXISTS idx_stmt_txns_book_fitid ON statement_transactions(book_id, fitid);
