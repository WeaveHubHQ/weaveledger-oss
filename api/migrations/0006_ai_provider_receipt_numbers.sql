-- Add receipt/invoice number fields for duplicate detection
ALTER TABLE receipts ADD COLUMN receipt_number TEXT;
ALTER TABLE receipts ADD COLUMN invoice_number TEXT;

-- Add AI provider preference to users
ALTER TABLE users ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'anthropic' CHECK (ai_provider IN ('anthropic', 'openai'));
