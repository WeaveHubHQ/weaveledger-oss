-- Demo seed data for Apple App Review
-- Deploy a demo instance with SUBSCRIPTION_ENFORCEMENT=none
-- Use these credentials for review: demo@weaveledger.app / DemoPass123!
--
-- To create the demo user, first deploy and register via the API:
--   curl -X POST https://your-demo.workers.dev/api/auth/register \
--     -H "Content-Type: application/json" \
--     -d '{"email":"demo@weaveledger.app","password":"DemoPass123!","name":"Demo User"}'
--
-- Then run this SQL to seed sample data:

-- Sample book
INSERT OR IGNORE INTO books (id, owner_id, name, description, currency, created_at, updated_at)
SELECT 'book_demo_001', id, 'Demo Business 2026', 'Sample business expense book', 'USD', datetime('now'), datetime('now')
FROM users WHERE email = 'demo@weaveledger.app';

-- Sample receipts
INSERT OR IGNORE INTO receipts (id, book_id, user_id, merchant, amount, currency, date, category, subcategory, description, payment_method, source, status, ai_confidence, tax_deductible, created_at, updated_at)
SELECT 'rcpt_demo_001', 'book_demo_001', id, 'Office Depot', 89.99, 'USD', '2026-03-15', 'Office Supplies', 'Printer Supplies', 'Ink cartridges and paper', 'Credit Card', 'manual', 'completed', 0.95, 1, datetime('now'), datetime('now') FROM users WHERE email = 'demo@weaveledger.app';

INSERT OR IGNORE INTO receipts (id, book_id, user_id, merchant, amount, currency, date, category, subcategory, description, payment_method, source, status, ai_confidence, tax_deductible, created_at, updated_at)
SELECT 'rcpt_demo_002', 'book_demo_001', id, 'AWS', 45.23, 'USD', '2026-03-14', 'Cloud Services', 'Hosting', 'Monthly hosting charges', 'Credit Card', 'manual', 'completed', 0.92, 1, datetime('now'), datetime('now') FROM users WHERE email = 'demo@weaveledger.app';

INSERT OR IGNORE INTO receipts (id, book_id, user_id, merchant, amount, currency, date, category, subcategory, description, payment_method, source, status, ai_confidence, tax_deductible, created_at, updated_at)
SELECT 'rcpt_demo_003', 'book_demo_001', id, 'Starbucks', 5.75, 'USD', '2026-03-13', 'Meals & Entertainment', 'Coffee', 'Client meeting coffee', 'Debit Card', 'manual', 'completed', 0.88, 1, datetime('now'), datetime('now') FROM users WHERE email = 'demo@weaveledger.app';

INSERT OR IGNORE INTO receipts (id, book_id, user_id, merchant, amount, currency, date, category, subcategory, description, payment_method, source, status, ai_confidence, tax_deductible, created_at, updated_at)
SELECT 'rcpt_demo_004', 'book_demo_001', id, 'Uber', 32.50, 'USD', '2026-03-12', 'Transportation', 'Rideshare', 'Trip to client office', 'Credit Card', 'manual', 'completed', 0.90, 1, datetime('now'), datetime('now') FROM users WHERE email = 'demo@weaveledger.app';

INSERT OR IGNORE INTO receipts (id, book_id, user_id, merchant, amount, currency, date, category, subcategory, description, payment_method, source, status, ai_confidence, tax_deductible, created_at, updated_at)
SELECT 'rcpt_demo_005', 'book_demo_001', id, 'Adobe Creative Cloud', 54.99, 'USD', '2026-03-01', 'Software', 'Design Tools', 'Monthly subscription', 'Credit Card', 'manual', 'completed', 0.94, 1, datetime('now'), datetime('now') FROM users WHERE email = 'demo@weaveledger.app';
