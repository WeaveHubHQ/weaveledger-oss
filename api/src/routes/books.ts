import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { canAccessBook } from '../middleware/auth';

export async function listBooks(request: Request, env: Env, userId: string): Promise<Response> {
  const owned = await env.DB.prepare(
    `SELECT b.*,
       (SELECT COUNT(*) FROM receipts WHERE book_id = b.id) as receipt_count,
       (SELECT COALESCE(SUM(amount), 0) FROM receipts WHERE book_id = b.id AND status = 'completed') as total_amount
     FROM books b WHERE b.owner_id = ? ORDER BY b.updated_at DESC`
  ).bind(userId).all();

  const shared = await env.DB.prepare(
    `SELECT b.*, bs.permission,
       (SELECT COUNT(*) FROM receipts WHERE book_id = b.id) as receipt_count,
       (SELECT COALESCE(SUM(amount), 0) FROM receipts WHERE book_id = b.id AND status = 'completed') as total_amount
     FROM books b
     JOIN book_shares bs ON bs.book_id = b.id
     WHERE bs.user_id = ? ORDER BY b.updated_at DESC`
  ).bind(userId).all();

  return success({ owned: owned.results, shared: shared.results });
}

export async function createBook(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ name: string; description?: string; currency?: string }>();
  if (!body.name) return error('Book name is required');
  if (body.name.length > 200) return error('Book name must be 200 characters or fewer');
  if (body.description && body.description.length > 2000) return error('Description must be 2000 characters or fewer');
  if (body.currency && body.currency.length > 10) return error('Invalid currency code');

  const id = generateId('book');
  await env.DB.prepare(
    'INSERT INTO books (id, owner_id, name, description, currency) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, body.name, body.description || null, body.currency || 'USD').run();

  const book = await env.DB.prepare('SELECT * FROM books WHERE id = ?').bind(id).first();
  return success(book, 'Book created');
}

export async function getBook(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId)) {
    return error('Book not found or access denied', 404);
  }

  const book = await env.DB.prepare('SELECT * FROM books WHERE id = ?').bind(bookId).first();
  if (!book) return error('Book not found', 404);

  const shares = await env.DB.prepare(
    `SELECT bs.*, u.email, u.name as user_name
     FROM book_shares bs JOIN users u ON u.id = bs.user_id
     WHERE bs.book_id = ?`
  ).bind(bookId).all();

  const invitations = await env.DB.prepare(
    `SELECT * FROM invitations WHERE book_id = ? AND status = 'pending' ORDER BY created_at DESC`
  ).bind(bookId).all();

  return success({ ...book, shares: shares.results, invitations: invitations.results });
}

export async function updateBook(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId, 'admin')) {
    return error('Access denied', 403);
  }

  const body = await request.json<{ name?: string; description?: string; currency?: string }>();
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
  if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description); }
  if (body.currency !== undefined) { updates.push('currency = ?'); values.push(body.currency); }

  if (updates.length === 0) return error('No fields to update');

  updates.push("updated_at = datetime('now')");
  values.push(bookId);

  await env.DB.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  const book = await env.DB.prepare('SELECT * FROM books WHERE id = ?').bind(bookId).first();
  return success(book);
}

export async function deleteBook(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  const book = await env.DB.prepare('SELECT owner_id FROM books WHERE id = ?').bind(bookId).first<{ owner_id: string }>();
  if (!book || book.owner_id !== userId) {
    return error('Only the owner can delete a book', 403);
  }

  // Delete associated receipt images from R2
  const receipts = await env.DB.prepare('SELECT image_key FROM receipts WHERE book_id = ? AND image_key IS NOT NULL').bind(bookId).all<{ image_key: string }>();
  for (const receipt of receipts.results) {
    await env.RECEIPTS_BUCKET.delete(receipt.image_key);
  }

  await env.DB.prepare('DELETE FROM books WHERE id = ?').bind(bookId).run();
  return success(null, 'Book deleted');
}

export async function shareBook(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  // Only owner or admin can share
  if (!await canAccessBook(env.DB, userId, bookId, 'admin')) {
    return error('Only the owner or an admin can share a book', 403);
  }

  const body = await request.json<{ email: string; role?: string }>();
  if (!body.email) return error('Email is required');
  const email = body.email.toLowerCase();

  const validRoles = ['reader', 'member', 'admin'];
  const role = validRoles.includes(body.role || '') ? body.role! : 'reader';

  // Check if it's the owner trying to share with themselves
  const ownerUser = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (ownerUser && ownerUser.email === email) return error('Cannot share with yourself');

  // Check if user exists
  const targetUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();

  if (targetUser) {
    // User exists — create direct share
    const shareId = generateId('share');
    await env.DB.prepare(
      `INSERT INTO book_shares (id, book_id, user_id, permission) VALUES (?, ?, ?, ?)
       ON CONFLICT(book_id, user_id) DO UPDATE SET permission = excluded.permission`
    ).bind(shareId, bookId, targetUser.id, role).run();

    // Clean up any pending invitation for this email/book
    await env.DB.prepare(
      `UPDATE invitations SET status = 'accepted', accepted_at = datetime('now') WHERE book_id = ? AND email = ? AND status = 'pending'`
    ).bind(bookId, email).run();

    return success(null, 'Book shared successfully');
  } else {
    // User doesn't exist — create an invitation
    const inviteId = generateId('inv');
    await env.DB.prepare(
      `INSERT INTO invitations (id, book_id, invited_by, email, role) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(book_id, email) DO UPDATE SET role = excluded.role, status = 'pending', invited_by = excluded.invited_by`
    ).bind(inviteId, bookId, userId, email, role).run();

    return success({ invitation_id: inviteId, status: 'pending' }, `Invitation sent. ${email} will get access when they register.`);
  }
}

export async function listInvitations(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId, 'admin')) {
    return error('Access denied', 403);
  }

  const invites = await env.DB.prepare(
    `SELECT i.*, u.name as invited_by_name FROM invitations i
     JOIN users u ON u.id = i.invited_by
     WHERE i.book_id = ? AND i.status = 'pending'
     ORDER BY i.created_at DESC`
  ).bind(bookId).all();

  return success(invites.results);
}

export async function revokeInvitation(request: Request, env: Env, userId: string, bookId: string, inviteId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId, 'admin')) {
    return error('Access denied', 403);
  }

  await env.DB.prepare(
    `UPDATE invitations SET status = 'revoked' WHERE id = ? AND book_id = ?`
  ).bind(inviteId, bookId).run();

  return success(null, 'Invitation revoked');
}

export async function revokeShare(request: Request, env: Env, userId: string, bookId: string, shareId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId, 'admin')) {
    return error('Only the owner or admin can revoke shares', 403);
  }

  await env.DB.prepare('DELETE FROM book_shares WHERE id = ? AND book_id = ?').bind(shareId, bookId).run();
  return success(null, 'Share revoked');
}
