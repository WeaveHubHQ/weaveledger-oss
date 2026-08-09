-- Book close/finalize: a closed book is read-only (no new receipts, edits, or
-- reports) until reopened. Owner-controlled. Default 'open' for existing books.
ALTER TABLE books ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
