-- Roles & Invitations Migration
-- Changes book_shares.permission from view/edit to reader/member/admin
-- Adds invitations table for sharing with non-registered users

-- Migrate existing permissions
UPDATE book_shares SET permission = 'reader' WHERE permission = 'view';
UPDATE book_shares SET permission = 'member' WHERE permission = 'edit';

-- Create invitations table for pending invites to non-registered users
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader', 'member', 'admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  UNIQUE(book_id, email)
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_book_id ON invitations(book_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
