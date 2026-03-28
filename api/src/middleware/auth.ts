import { Env, JWTPayload } from '../types';
import { verifyJWT, deriveDownloadKey } from '../utils/crypto';
import { error } from '../utils/response';

export interface AuthenticatedRequest {
  user: JWTPayload;
}

export async function authenticate(request: Request, env: Env): Promise<JWTPayload | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return error('Missing or invalid Authorization header', 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) {
    return error('Invalid or expired token', 401);
  }

  // Verify token_version hasn't been bumped (password change, MFA toggle, etc.)
  if (payload.tv !== undefined) {
    const user = await env.DB.prepare('SELECT token_version FROM users WHERE id = ?').bind(payload.sub).first<{ token_version: number | null }>();
    if (user && (user.token_version || 0) > payload.tv) {
      return error('Session expired. Please log in again.', 401);
    }
  }

  return payload;
}

// Verify a short-lived download token (HMAC-based, no JWT query param exposure)
export async function authenticateDownload(request: Request, env: Env): Promise<{ userId: string; bookId: string; format: string } | Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('dl_token');
  const expires = url.searchParams.get('expires');

  if (!token || !expires) {
    return error('Missing download token', 401);
  }

  const expiresNum = parseInt(expires);
  if (isNaN(expiresNum) || expiresNum < Math.floor(Date.now() / 1000)) {
    return error('Download link expired', 401);
  }

  // Extract resource info from path
  const pathMatch = url.pathname.match(/^\/api\/books\/([^/]+)\/export\/(csv|json|pdf|qbo|ofx)$/);
  if (!pathMatch) {
    return error('Invalid download path', 400);
  }

  const [, bookId, format] = pathMatch;

  const userIdParam = url.searchParams.get('uid');
  if (!userIdParam) return error('Invalid download token', 401);

  // Verify HMAC over path:userId:expires using derived key (not JWT_SECRET directly)
  const encoder = new TextEncoder();
  const key = await deriveDownloadKey(env.JWT_SECRET);
  const message = `${url.pathname}:${userIdParam}:${expires}`;
  const sigBytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(message));

  if (!valid) {
    return error('Invalid download token', 401);
  }

  return { userId: userIdParam, bookId, format };
}

// D1-backed rate limiter — durable across Worker cold starts and shared across isolates.
// For additional production-grade protection, configure Cloudflare Rate Limiting rules
// in the dashboard (WAF -> Rate limiting rules).
export async function checkRateLimit(request: Request, db: D1Database, limit: number = 10, windowMs: number = 60_000): Promise<Response | null> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const windowStart = now - windowMs;
  const key = `ip:${ip}`;

  try {
    // Record this request
    await db.prepare('INSERT INTO rate_limits (key, timestamp) VALUES (?, ?)').bind(key, now).run();

    // Count requests in the current window
    const result = await db.prepare(
      'SELECT COUNT(*) as cnt FROM rate_limits WHERE key = ? AND timestamp > ?'
    ).bind(key, windowStart).first<{ cnt: number }>();

    // Periodically clean up old entries (1 in 20 chance to avoid doing it every request)
    if (Math.random() < 0.05) {
      await db.prepare('DELETE FROM rate_limits WHERE timestamp < ?').bind(windowStart - windowMs).run();
    }

    if (result && result.cnt > limit) {
      return error('Too many requests. Please try again later.', 429);
    }
  } catch (e) {
    // If rate limiting fails (e.g. table doesn't exist yet), allow the request
    console.error('Rate limit check failed:', e);
  }

  return null;
}

// Subscription paywall enforcement
export async function requireSubscription(
  db: D1Database, userId: string, enforcement: string | undefined
): Promise<Response | null> {
  // Self-hosted instances: no enforcement
  if (!enforcement || enforcement === 'none') return null;

  const user = await db.prepare(
    'SELECT subscription_tier, subscription_expires_at FROM users WHERE id = ?'
  ).bind(userId).first<{ subscription_tier: string; subscription_expires_at: string | null }>();

  if (!user) return error('User not found', 404);

  if (user.subscription_tier === 'pro' && user.subscription_expires_at) {
    // Allow 3-day grace period for billing retry
    const expiresAt = new Date(user.subscription_expires_at);
    const grace = new Date(expiresAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    if (grace > new Date()) return null;
  }

  return new Response(JSON.stringify({ error: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' }), {
    status: 403, headers: { 'Content-Type': 'application/json' }
  });
}

// Permission levels: reader (view only), member (view + upload receipts), admin (full control except delete book)
export type RequiredPermission = 'reader' | 'member' | 'admin';

export async function canAccessBook(db: D1Database, userId: string, bookId: string, requireEdit: boolean | RequiredPermission = false): Promise<boolean> {
  // Check if user owns the book — owners always have full access
  const book = await db.prepare('SELECT owner_id FROM books WHERE id = ?').bind(bookId).first<{ owner_id: string }>();
  if (!book) return false;
  if (book.owner_id === userId) return true;

  // Check if user has a share
  const share = await db.prepare(
    'SELECT permission FROM book_shares WHERE book_id = ? AND user_id = ?'
  ).bind(bookId, userId).first<{ permission: string }>();

  if (!share) return false;

  // Determine required permission level
  const required: RequiredPermission = typeof requireEdit === 'string'
    ? requireEdit
    : requireEdit ? 'member' : 'reader';

  const levels: Record<string, number> = { reader: 1, member: 2, admin: 3 };
  const userLevel = levels[share.permission] || 0;
  const requiredLevel = levels[required] || 0;

  return userLevel >= requiredLevel;
}

export async function getBookRole(db: D1Database, userId: string, bookId: string): Promise<'owner' | 'admin' | 'member' | 'reader' | null> {
  const book = await db.prepare('SELECT owner_id FROM books WHERE id = ?').bind(bookId).first<{ owner_id: string }>();
  if (!book) return null;
  if (book.owner_id === userId) return 'owner';

  const share = await db.prepare(
    'SELECT permission FROM book_shares WHERE book_id = ? AND user_id = ?'
  ).bind(bookId, userId).first<{ permission: string }>();

  if (!share) return null;
  return share.permission as 'admin' | 'member' | 'reader';
}
