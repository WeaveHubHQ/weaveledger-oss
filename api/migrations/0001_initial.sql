-- WeaveLedger Initial Schema
-- Receipt & Expense Tracking Platform

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE books (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE book_shares (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(book_id, user_id)
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE receipts (
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  ai_confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE line_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  total REAL NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(book_id, name)
);

CREATE TABLE receipt_tags (
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (receipt_id, tag_id)
);

-- Indexes for common queries
CREATE INDEX idx_receipts_book_id ON receipts(book_id);
CREATE INDEX idx_receipts_user_id ON receipts(user_id);
CREATE INDEX idx_receipts_date ON receipts(date);
CREATE INDEX idx_receipts_category ON receipts(category);
CREATE INDEX idx_receipts_status ON receipts(status);
CREATE INDEX idx_receipts_merchant ON receipts(merchant);
CREATE INDEX idx_books_owner_id ON books(owner_id);
CREATE INDEX idx_book_shares_user_id ON book_shares(user_id);
CREATE INDEX idx_book_shares_book_id ON book_shares(book_id);
CREATE INDEX idx_categories_book_id ON categories(book_id);
CREATE INDEX idx_line_items_receipt_id ON line_items(receipt_id);

-- Insert default categories
INSERT INTO categories (id, name, icon, is_default) VALUES
  ('cat_food', 'Food & Dining', 'fork.knife', 1),
  ('cat_transport', 'Transportation', 'car.fill', 1),
  ('cat_office', 'Office Supplies', 'pencil.and.ruler.fill', 1),
  ('cat_tech', 'Technology', 'desktopcomputer', 1),
  ('cat_travel', 'Travel', 'airplane', 1),
  ('cat_utilities', 'Utilities', 'bolt.fill', 1),
  ('cat_entertainment', 'Entertainment', 'film.fill', 1),
  ('cat_health', 'Health & Medical', 'heart.fill', 1),
  ('cat_insurance', 'Insurance', 'shield.fill', 1),
  ('cat_professional', 'Professional Services', 'briefcase.fill', 1),
  ('cat_marketing', 'Marketing & Advertising', 'megaphone.fill', 1),
  ('cat_rent', 'Rent & Lease', 'building.2.fill', 1),
  ('cat_subscriptions', 'Subscriptions', 'repeat', 1),
  ('cat_taxes', 'Taxes & Fees', 'doc.text.fill', 1),
  ('cat_education', 'Education & Training', 'graduationcap.fill', 1),
  ('cat_shipping', 'Shipping & Postage', 'shippingbox.fill', 1),
  ('cat_maintenance', 'Repairs & Maintenance', 'wrench.fill', 1),
  ('cat_other', 'Other', 'square.grid.2x2.fill', 1);
