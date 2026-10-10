-- users.rc_product_id: the product whose RevenueCat event last granted Pro.
-- Lets the webhook tell "the subscription this user is on just ended" from
-- "an older, different subscription ended while a newer one is active".
ALTER TABLE users ADD COLUMN rc_product_id TEXT;

-- books.auto_created: set for the "Default" book the inbound-email handler
-- creates. Such a book does not use up the free tier's one book.
ALTER TABLE books ADD COLUMN auto_created INTEGER NOT NULL DEFAULT 0;
UPDATE books SET auto_created = 1 WHERE name = 'Default' AND description = 'Auto-created for email receipts';
