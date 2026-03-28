-- Budgets table
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  book_id TEXT NOT NULL REFERENCES books(id),
  category TEXT NOT NULL,
  amount INTEGER NOT NULL, -- cents
  period TEXT NOT NULL DEFAULT 'monthly', -- monthly, quarterly, yearly
  start_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(book_id, category, period)
);

-- Recurring expenses table
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  book_id TEXT NOT NULL REFERENCES books(id),
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT,
  frequency TEXT NOT NULL DEFAULT 'monthly', -- weekly, monthly, quarterly, yearly
  next_due_date TEXT NOT NULL,
  auto_create INTEGER DEFAULT 0,
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tax fields on receipts
ALTER TABLE receipts ADD COLUMN tax_deductible INTEGER DEFAULT 0;
ALTER TABLE receipts ADD COLUMN tax_category TEXT;

-- Tax settings table
CREATE TABLE IF NOT EXISTS tax_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  filing_status TEXT DEFAULT 'single', -- single, married_joint, married_separate, head_of_household
  estimated_annual_tax_rate REAL DEFAULT 25.0,
  state TEXT,
  state_tax_rate REAL DEFAULT 0,
  self_employment_tax_rate REAL DEFAULT 15.3,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
