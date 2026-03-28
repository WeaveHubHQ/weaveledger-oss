-- Store multiple attachments per receipt
ALTER TABLE receipts ADD COLUMN attachments TEXT;
-- JSON array of {key, filename, content_type, size}
