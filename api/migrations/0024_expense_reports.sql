-- Expense reports: user-selected bundles of receipts to hand to a business
-- for reimbursement or invoicing. See docs/expense-reports-spec.md.
--
-- Receipts link via a join table (a receipt may appear on more than one
-- report over time); totals are always computed at read time from the
-- joined receipts, never stored.

CREATE TABLE IF NOT EXISTS expense_reports (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'reimbursed')),
  submitted_at TEXT,
  reimbursed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_report_items (
  report_id TEXT NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (report_id, receipt_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_reports_book ON expense_reports(book_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_report_items_receipt ON expense_report_items(receipt_id);
