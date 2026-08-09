import { Env } from '../types';
import { generateId, hashPassword, verifyPassword, createJWT, encryptValue, decryptValue, deriveDownloadKey, createRefreshToken, hashRefreshToken } from '../utils/crypto';
import { generateSecret, getOTPAuthURL, verifyTOTP } from '../utils/totp';
import { json, error, success } from '../utils/response';

// Public, unauthenticated: tells the login screen whether to offer account
// creation and whether this is a brand-new (no-users) instance, so a freshly
// provisioned tenant greets the owner with "Create your account" instead of
// "Welcome back". Never leaks user data — only a boolean and the mode.
export async function registrationStatus(request: Request, env: Env): Promise<Response> {
  const mode = env.REGISTRATION || 'open';
  const hasUsers = !!(await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first());
  // Whether the generic (token-less) "Create an account" link should appear.
  // 'invite' needs a per-email invitation, so the generic link stays hidden.
  const canRegister = mode === 'open' || (mode === 'first_user' && !hasUsers);
  return success({ mode, hasUsers, canRegister });
}

export async function register(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ email: string; password: string; name: string }>();
  if (!body.email || !body.password || !body.name) {
    return error('Email, password, and name are required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    return error('Invalid email address');
  }

  if (body.password.length < 8 || body.password.length > 128) {
    return error('Password must be between 8 and 128 characters');
  }

  if (body.name.length > 200) {
    return error('Name must be 200 characters or fewer');
  }

  // Self-hosting registration gate (env.REGISTRATION, default "open"):
  //   "open"       — anyone can register
  //   "first_user" — registration closes once any account exists (recommended
  //                  for single-owner self-hosted instances)
  //   "invite"     — the email must hold a pending book invitation
  // Unrecognized values fail closed so a typo can't silently open registration.
  const registrationMode = env.REGISTRATION || 'open';
  if (registrationMode === 'first_user') {
    const anyUser = await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
    if (anyUser) {
      return error('Registration is closed on this server. The owner can set REGISTRATION = "open" or "invite" in wrangler.toml to allow new accounts.', 403);
    }
  } else if (registrationMode === 'invite') {
    const invite = await env.DB.prepare(
      "SELECT 1 FROM invitations WHERE email = ? AND status = 'pending' LIMIT 1"
    ).bind(body.email.toLowerCase()).first();
    if (!invite) {
      return error('Registration is invite-only on this server. Ask an existing user to share a book with your email address first.', 403);
    }
  } else if (registrationMode !== 'open') {
    return error('Registration is disabled: unrecognized REGISTRATION mode. Use "open", "first_user", or "invite".', 403);
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email.toLowerCase()).first();
  if (existing) {
    return error('Email already registered', 409);
  }

  const id = generateId('usr');
  const passwordHash = await hashPassword(body.password);

  await env.DB.prepare(
    'INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, body.email.toLowerCase(), body.name, passwordHash, 'owner').run();

  // Auto-accept any pending invitations for this email
  const pendingInvites = await env.DB.prepare(
    `SELECT id, book_id, role FROM invitations WHERE email = ? AND status = 'pending'`
  ).bind(body.email.toLowerCase()).all<{ id: string; book_id: string; role: string }>();

  for (const invite of pendingInvites.results) {
    const shareId = generateId('share');
    await env.DB.prepare(
      `INSERT INTO book_shares (id, book_id, user_id, permission) VALUES (?, ?, ?, ?)
       ON CONFLICT(book_id, user_id) DO UPDATE SET permission = excluded.permission`
    ).bind(shareId, invite.book_id, id, invite.role).run();

    await env.DB.prepare(
      `UPDATE invitations SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?`
    ).bind(invite.id).run();
  }

  const token = await createJWT({ sub: id, email: body.email.toLowerCase(), role: 'owner', tv: 0 }, env.JWT_SECRET);

  // Issue a refresh token
  const refreshToken = await createRefreshToken();
  const refreshTokenHash = await hashRefreshToken(refreshToken, env.JWT_SECRET);
  const refreshId = generateId('rt');
  await env.DB.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash) VALUES (?, ?, ?)"
  ).bind(refreshId, id, refreshTokenHash).run();

  return json({ token, refreshToken, user: { id, email: body.email.toLowerCase(), name: body.name, role: 'owner' } }, 201);
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

export async function login(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ email: string; password: string; mfa_code?: string }>();
  if (!body.email || !body.password) {
    return error('Email and password are required');
  }

  const user = await env.DB.prepare(
    'SELECT id, email, name, password_hash, role, mfa_enabled, mfa_secret, failed_login_attempts, locked_until, token_version FROM users WHERE email = ?'
  ).bind(body.email.toLowerCase()).first<{ id: string; email: string; name: string; password_hash: string; role: string; mfa_enabled: number; mfa_secret: string | null; failed_login_attempts: number; locked_until: string | null; token_version: number }>();

  if (!user) {
    // Constant-time: still hash to prevent timing attacks revealing user existence
    await hashPassword(body.password);
    return error('Invalid credentials', 401);
  }

  // Check account lockout
  if (user.locked_until) {
    const lockedUntil = new Date(user.locked_until + 'Z').getTime();
    if (Date.now() < lockedUntil) {
      const minutesLeft = Math.ceil((lockedUntil - Date.now()) / 60000);
      return error(`Account locked. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`, 423);
    }
    // Lock expired, reset
    await env.DB.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?").bind(user.id).run();
    user.failed_login_attempts = 0;
    user.locked_until = null;
  }

  let valid: boolean;
  try {
    valid = await verifyPassword(body.password, user.password_hash);
  } catch (e: any) {
    if (e?.message === 'PASSWORD_RESET_REQUIRED') {
      return error('Your password must be reset. Please use the "Forgot Password" feature to set a new password.', 401);
    }
    throw e;
  }
  if (!valid) {
    const attempts = (user.failed_login_attempts || 0) + 1;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60000).toISOString().replace('Z', '');
      await env.DB.prepare("UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?").bind(attempts, lockUntil, user.id).run();
      return error(`Account locked due to too many failed attempts. Try again in ${LOCKOUT_DURATION_MINUTES} minutes.`, 423);
    }
    await env.DB.prepare("UPDATE users SET failed_login_attempts = ? WHERE id = ?").bind(attempts, user.id).run();
    return error('Invalid credentials', 401);
  }

  // Check MFA
  if (user.mfa_enabled && user.mfa_secret) {
    if (!body.mfa_code) {
      return json({ mfa_required: true }, 200);
    }
    let mfaSecret: string;
    try {
      mfaSecret = await decryptValue(user.mfa_secret, env.JWT_SECRET, user.id);
    } catch {
      // Fallback: try decrypting without per-user salt (v1 format)
      try {
        mfaSecret = await decryptValue(user.mfa_secret, env.JWT_SECRET);
        // Re-encrypt with per-user salt so future logins use v2
        const reEncrypted = await encryptValue(mfaSecret, env.JWT_SECRET, user.id);
        await env.DB.prepare("UPDATE users SET mfa_secret = ? WHERE id = ?").bind(reEncrypted, user.id).run();
      } catch {
        return error('MFA verification failed. Please contact support.', 500);
      }
    }
    const mfaValid = await verifyTOTP(mfaSecret, body.mfa_code);
    if (!mfaValid) {
      return error('Invalid MFA code', 401);
    }
  }

  // Reset failed attempts on successful login
  if (user.failed_login_attempts > 0) {
    await env.DB.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?").bind(user.id).run();
  }

  const token = await createJWT({ sub: user.id, email: user.email, role: user.role, tv: user.token_version || 0 }, env.JWT_SECRET);

  // Issue a refresh token (30-day, rotated on use)
  const refreshToken = await createRefreshToken();
  const refreshTokenHash = await hashRefreshToken(refreshToken, env.JWT_SECRET);
  const refreshId = generateId('rt');
  await env.DB.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash) VALUES (?, ?, ?)"
  ).bind(refreshId, user.id, refreshTokenHash).run();

  return json({ token, refreshToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}

export async function changePassword(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ current_password: string; new_password: string }>();
  if (!body.current_password || !body.new_password) {
    return error('Current and new passwords are required');
  }

  if (body.new_password.length < 8 || body.new_password.length > 128) {
    return error('New password must be between 8 and 128 characters');
  }

  const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(userId).first<{ password_hash: string }>();
  if (!user) return error('User not found', 404);

  const valid = await verifyPassword(body.current_password, user.password_hash);
  if (!valid) return error('Current password is incorrect', 401);

  const newHash = await hashPassword(body.new_password);
  await env.DB.prepare("UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1, updated_at = datetime('now') WHERE id = ?").bind(newHash, userId).run();

  // Invalidate all refresh tokens on password change
  await env.DB.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").bind(userId).run();

  return success(null, 'Password changed successfully. All other sessions have been invalidated.');
}

export async function getProfile(request: Request, env: Env, userId: string): Promise<Response> {
  const user = await env.DB.prepare(
    'SELECT id, email, name, role, mfa_enabled, ai_provider, weavehub_ai_enabled, anthropic_api_key, openai_api_key, weavehub_ai_key, subscription_tier, subscription_expires_at, created_at FROM users WHERE id = ?'
  ).bind(userId).first<Record<string, unknown>>();

  if (!user) return error('User not found', 404);

  const linkedEmails = await env.DB.prepare(
    'SELECT id, email, verified, created_at FROM user_emails WHERE user_id = ? ORDER BY created_at'
  ).bind(userId).all();

  return success({
    ...user,
    // Present the effective provider; the flag is an internal storage detail.
    ai_provider: user.weavehub_ai_enabled ? 'weavehub' : user.ai_provider,
    weavehub_ai_enabled: undefined,
    anthropic_api_key: user.anthropic_api_key ? true : false,
    openai_api_key: user.openai_api_key ? true : false,
    weavehub_ai_key: user.weavehub_ai_key ? true : false,
    linked_emails: linkedEmails.results,
  });
}

// Linked email management for receipt capture.
//
// Verification model (LED-26 r2): for any address that can't be auto-trusted,
// the worker issues a 256-bit URL-safe random token (1-hour TTL) and emails a
// magic link to that address via env.SEND_EMAIL (Cloudflare Email Service,
// public beta April 2026). The recipient clicks the link, which hits the
// public GET /verify-email?t=<token> route, marks verified=1, and shows a
// branded success page. No copy-paste, no outbound vendor.
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'zoho.com', 'mail.com', 'gmx.com', 'gmx.net',
  'fastmail.com', 'tutanota.com', 'tuta.com', 'hey.com', 'pm.me',
]);

const VERIFICATION_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_SENDER = 'noreply@business.weavehub.app';
const VERIFY_SENDER_NAME = 'WeaveLedger';
const VERIFY_BASE_URL = 'https://ledger.weavehub.app/api/verify-email';

// 32 random bytes → 43-char URL-safe base64. ~256 bits of entropy — bearer
// auth grade. Used as the token in the magic link.
function generateVerificationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildVerificationEmail(linkedAddress: string, magicLink: string): { html: string; text: string } {
  const text = [
    `You requested to link ${linkedAddress} as a sender address for your WeaveLedger account.`,
    '',
    `Click this link within 1 hour to verify:`,
    magicLink,
    '',
    `If you didn't request this, ignore this email — no changes will be made.`,
  ].join('\n');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0A1628;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F0E8;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;border:1px solid #E8E0D0;">
        <tr><td style="padding:32px 32px 8px 32px;">
          <div style="font-family:'Times New Roman',Georgia,serif;font-size:24px;line-height:1.2;">
            <span style="color:#0A1628;">Weave</span><span style="color:#C9A84C;">Ledger</span>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 8px 32px;">
          <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#0A1628;">Verify your sender address</h1>
          <p style="font-size:15px;line-height:1.5;margin:0 0 16px 0;color:#0A1628;">
            You requested to link <strong>${escapeHtml(linkedAddress)}</strong> as a sender address for your WeaveLedger account.
            Click the button below to confirm — receipts forwarded from this address will then be attributed to your account.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:8px 32px 24px 32px;">
          <a href="${magicLink}" style="display:inline-block;background:#C9A84C;color:#0A1628;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:12px;">Verify this address</a>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;">
          <p style="font-size:13px;line-height:1.5;margin:0 0 8px 0;color:#4B5563;">
            Or copy and paste this URL into your browser:
          </p>
          <p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all;background:#E8E0D0;padding:10px 12px;border-radius:8px;margin:0 0 16px 0;color:#0A1628;">
            ${magicLink}
          </p>
          <p style="font-size:12px;line-height:1.5;margin:0;color:#6B7280;">
            This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendVerificationEmail(env: Env, linkedAddress: string, token: string): Promise<void> {
  const magicLink = `${VERIFY_BASE_URL}?t=${encodeURIComponent(token)}`;
  const { html, text } = buildVerificationEmail(linkedAddress, magicLink);

  if (!env.SEND_EMAIL) throw new Error('Email sending is not available on this deployment');
  await env.SEND_EMAIL.send({
    to: linkedAddress,
    from: `${VERIFY_SENDER_NAME} <${VERIFY_SENDER}>`,
    subject: 'Verify your WeaveLedger sender address',
    html,
    text,
  });
}

export async function addLinkedEmail(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ email: string }>();
  if (!body.email) return error('Email is required');

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) return error('Invalid email address');

  const email = body.email.toLowerCase();

  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existingUser) return error('This email is already a primary account email', 409);

  const existingLink = await env.DB.prepare('SELECT id, user_id, verified FROM user_emails WHERE email = ?')
    .bind(email).first<{ id: string; user_id: string; verified: number }>();
  if (existingLink) return error('This email is already linked to an account', 409);

  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (!user) return error('User not found', 404);

  const primaryDomain = user.email.split('@')[1].toLowerCase();
  const linkedDomain = email.split('@')[1].toLowerCase();
  const sameCustomDomain = primaryDomain === linkedDomain && !PUBLIC_EMAIL_DOMAINS.has(primaryDomain);

  const id = generateId('ue');

  // Same custom domain → trust transitively: the user already proved control
  // of the domain by registering their primary on it.
  if (sameCustomDomain) {
    await env.DB.prepare(
      'INSERT INTO user_emails (id, user_id, email, verified) VALUES (?, ?, ?, 1)'
    ).bind(id, userId, email).run();

    return success(
      { id, email, verified: true },
      'Email linked successfully. Receipts sent from this address will be attributed to your account.'
    );
  }

  // Public-provider or cross-domain → magic-link verification.
  const token = generateVerificationToken();
  const expires = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();

  await env.DB.prepare(
    'INSERT INTO user_emails (id, user_id, email, verification_code, verification_expires) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, email, token, expires).run();

  try {
    await sendVerificationEmail(env, email, token);
  } catch (err) {
    // Roll back the pending row — leaving an unsent pending verification
    // would block the user from re-adding the same address.
    await env.DB.prepare('DELETE FROM user_emails WHERE id = ?').bind(id).run();
    console.error('[Auth] Failed to send verification email:', err);
    return error('Could not send verification email. Try again in a moment.', 502);
  }

  return success(
    { id, email, verified: false, verification_expires: expires },
    `We sent a verification link to ${email}. Tap the link in that email within 1 hour, then return here and refresh.`
  );
}

// Re-send the magic link (e.g., if the user lost or expired the original).
export async function resendLinkedEmailVerification(
  request: Request, env: Env, userId: string, emailId: string,
): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT id, email, verified FROM user_emails WHERE id = ? AND user_id = ?'
  ).bind(emailId, userId).first<{ id: string; email: string; verified: number }>();

  if (!row) return error('Linked email not found', 404);
  if (row.verified === 1) return error('Email is already verified', 409);

  const token = generateVerificationToken();
  const expires = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();

  await env.DB.prepare(
    'UPDATE user_emails SET verification_code = ?, verification_expires = ? WHERE id = ?'
  ).bind(token, expires, emailId).run();

  try {
    await sendVerificationEmail(env, row.email, token);
  } catch (err) {
    console.error('[Auth] Failed to re-send verification email:', err);
    return error('Could not send verification email. Try again in a moment.', 502);
  }

  return success(
    { id: row.id, email: row.email, verified: false, verification_expires: expires },
    `New verification link sent to ${row.email}.`
  );
}

// Public route — bearer auth is the token itself. Hit by clicking the link in
// the verification email. Marks the linked email verified and returns a small
// branded HTML page.
export async function verifyLinkedEmailLink(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('t');

  if (!token) return verificationPage('Missing verification token', 'This verification URL is incomplete. Request a new link from WeaveLedger and try again.', 400);

  const row = await env.DB.prepare(
    `SELECT id, email, verified, verification_expires FROM user_emails
     WHERE verification_code = ?`
  ).bind(token).first<{ id: string; email: string; verified: number; verification_expires: string | null }>();

  if (!row) return verificationPage('Link not recognized', "This verification link isn't valid. It may have already been used, or a newer link was sent. Request a new link from WeaveLedger and try the most recent email.", 404);

  if (row.verified === 1) {
    return verificationPage('Already verified', `${row.email} is already linked to your WeaveLedger account. You can close this tab.`, 200, true);
  }

  if (row.verification_expires && new Date(row.verification_expires).getTime() < Date.now()) {
    return verificationPage('Link expired', 'Verification links are valid for 1 hour. Request a new one from WeaveLedger and try again.', 410);
  }

  await env.DB.prepare(
    'UPDATE user_emails SET verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ?'
  ).bind(row.id).run();

  return verificationPage('Verified', `${row.email} is now linked to your WeaveLedger account. Return to the app and tap Check status — receipts forwarded from this address will be attributed to your account.`, 200, true);
}

function verificationPage(heading: string, body: string, status: number, ok: boolean = false): Response {
  const accent = ok ? '#C9A84C' : '#0A1628';
  const icon = ok ? '✓' : '•';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)} — WeaveLedger</title>
<style>
  body{margin:0;background:#0A1628;color:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
  .card{max-width:480px;width:100%;background:#132240;border-radius:20px;padding:40px 32px;text-align:center;border:1px solid #1A3058;}
  .brand{font-family:'Times New Roman',Georgia,serif;font-size:28px;margin-bottom:24px;}
  .brand .a{color:#FFFFFF;} .brand .b{color:#E4CC7A;}
  .icon{font-size:48px;color:${accent};margin-bottom:8px;line-height:1;}
  h1{font-size:22px;font-weight:600;margin:0 0 12px 0;}
  p{font-size:15px;line-height:1.5;margin:0;color:rgba(245,240,232,0.85);}
</style></head>
<body><div class="card">
  <div class="brand"><span class="a">Weave</span><span class="b">Ledger</span></div>
  <div class="icon">${icon}</div>
  <h1>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(body)}</p>
</div></body></html>`;

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin',
      'Cache-Control': 'no-store',
    },
  });
}

export async function removeLinkedEmail(request: Request, env: Env, userId: string, emailId: string): Promise<Response> {
  const result = await env.DB.prepare(
    'DELETE FROM user_emails WHERE id = ? AND user_id = ?'
  ).bind(emailId, userId).run();

  if (!result.meta.changes) return error('Linked email not found', 404);
  return success(null, 'Email removed');
}

export async function listLinkedEmails(request: Request, env: Env, userId: string): Promise<Response> {
  const emails = await env.DB.prepare(
    'SELECT id, email, verified, created_at FROM user_emails WHERE user_id = ? ORDER BY created_at'
  ).bind(userId).all();

  return success(emails.results);
}

export async function updatePreferences(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ ai_provider?: string; anthropic_api_key?: string | null; openai_api_key?: string | null; weavehub_ai_key?: string | null }>();

  if (body.ai_provider !== undefined) {
    const valid = ['anthropic', 'openai', 'weavehub'];
    if (!valid.includes(body.ai_provider)) {
      return error('Invalid AI provider. Must be: anthropic, openai, or weavehub.');
    }
    // 'weavehub' is stored as a flag (users.ai_provider has a CHECK limited to
    // the BYO providers); ai_provider keeps the BYO fallback preference.
    if (body.ai_provider === 'weavehub') {
      await env.DB.prepare(
        "UPDATE users SET weavehub_ai_enabled = 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(userId).run();
    } else {
      await env.DB.prepare(
        "UPDATE users SET ai_provider = ?, weavehub_ai_enabled = 0, updated_at = datetime('now') WHERE id = ?"
      ).bind(body.ai_provider, userId).run();
    }
  }

  // Store API keys encrypted (per-user salt)
  if (body.anthropic_api_key !== undefined) {
    const encrypted = body.anthropic_api_key
      ? await encryptValue(body.anthropic_api_key, env.JWT_SECRET, userId)
      : null;
    await env.DB.prepare(
      "UPDATE users SET anthropic_api_key = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(encrypted, userId).run();
  }

  if (body.openai_api_key !== undefined) {
    const encrypted = body.openai_api_key
      ? await encryptValue(body.openai_api_key, env.JWT_SECRET, userId)
      : null;
    await env.DB.prepare(
      "UPDATE users SET openai_api_key = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(encrypted, userId).run();
  }

  if (body.weavehub_ai_key !== undefined) {
    if (body.weavehub_ai_key && !body.weavehub_ai_key.startsWith('wh_ai_')) {
      return error('WeaveHub AI keys start with wh_ai_');
    }
    const encrypted = body.weavehub_ai_key
      ? await encryptValue(body.weavehub_ai_key, env.JWT_SECRET, userId)
      : null;
    await env.DB.prepare(
      "UPDATE users SET weavehub_ai_key = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(encrypted, userId).run();
  }

  return success(null, 'Preferences updated');
}

export async function getUserApiKey(env: Env, userId: string, provider: 'anthropic' | 'openai'): Promise<string> {
  const col = provider === 'anthropic' ? 'anthropic_api_key' : 'openai_api_key';
  const user = await env.DB.prepare(`SELECT ${col} as key FROM users WHERE id = ?`).bind(userId).first<{ key: string | null }>();

  if (user?.key) {
    try {
      return await decryptValue(user.key, env.JWT_SECRET, userId);
    } catch {
      // Fall through to env secret
    }
  }

  // Fallback to global env secrets
  return provider === 'anthropic' ? env.CLAUDE_API_KEY : env.OPENAI_API_KEY;
}

// MFA Setup - requires password re-authentication, generates a secret and returns OTP auth URL
// QR code generation is left to the client (iOS app) to avoid sending TOTP secrets to third parties
export async function mfaSetup(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ password: string }>();
  if (!body.password) return error('Password is required to set up MFA');

  const user = await env.DB.prepare('SELECT email, password_hash, mfa_enabled FROM users WHERE id = ?').bind(userId).first<{ email: string; password_hash: string; mfa_enabled: number }>();
  if (!user) return error('User not found', 404);
  if (user.mfa_enabled) return error('MFA is already enabled. Disable it first.', 400);

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) return error('Invalid password', 401);

  const secret = generateSecret();
  const otpauthUrl = getOTPAuthURL(secret, user.email);

  // Store the secret encrypted with per-user salt
  const encryptedSecret = await encryptValue(secret, env.JWT_SECRET, userId);
  await env.DB.prepare("UPDATE users SET mfa_secret = ?, updated_at = datetime('now') WHERE id = ?").bind(encryptedSecret, userId).run();

  // Return secret + otpauth_url for client-side QR generation (no external service)
  return success({ secret, otpauth_url: otpauthUrl });
}

// MFA Enable - verifies a code and enables MFA
export async function mfaEnable(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ code: string }>();
  if (!body.code) return error('Verification code is required');

  const user = await env.DB.prepare('SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?').bind(userId).first<{ mfa_secret: string | null; mfa_enabled: number }>();
  if (!user) return error('User not found', 404);
  if (user.mfa_enabled) return error('MFA is already enabled', 400);
  if (!user.mfa_secret) return error('Run MFA setup first', 400);

  let decryptedSecret: string;
  try {
    decryptedSecret = await decryptValue(user.mfa_secret, env.JWT_SECRET, userId);
  } catch {
    return error('MFA setup corrupted. Please disable and re-setup MFA.', 500);
  }

  const valid = await verifyTOTP(decryptedSecret, body.code);
  if (!valid) return error('Invalid verification code. Please try again.', 400);

  await env.DB.prepare("UPDATE users SET mfa_enabled = 1, token_version = COALESCE(token_version, 0) + 1, updated_at = datetime('now') WHERE id = ?").bind(userId).run();

  return success(null, 'MFA enabled successfully');
}

// MFA Disable - requires password + TOTP code confirmation
export async function mfaDisable(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ password: string; code: string }>();
  if (!body.password) return error('Password is required to disable MFA');
  if (!body.code) return error('MFA code is required to disable MFA');

  const user = await env.DB.prepare('SELECT password_hash, mfa_enabled, mfa_secret FROM users WHERE id = ?').bind(userId).first<{ password_hash: string; mfa_enabled: number; mfa_secret: string | null }>();
  if (!user) return error('User not found', 404);
  if (!user.mfa_enabled) return error('MFA is not enabled', 400);
  if (!user.mfa_secret) return error('MFA secret not found', 500);

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) return error('Invalid password', 401);

  // Verify TOTP code
  let mfaSecret: string;
  try {
    mfaSecret = await decryptValue(user.mfa_secret, env.JWT_SECRET, userId);
  } catch {
    return error('Could not verify MFA code. Please try again.', 500);
  }
  const mfaValid = await verifyTOTP(mfaSecret, body.code);
  if (!mfaValid) return error('Invalid MFA code', 401);

  await env.DB.prepare("UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, token_version = COALESCE(token_version, 0) + 1, updated_at = datetime('now') WHERE id = ?").bind(userId).run();

  return success(null, 'MFA disabled successfully');
}

// Password Reset - Request (sends email with reset link)
export async function forgotPassword(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ email: string }>();
  if (!body.email) return error('Email is required');

  // Always return success to prevent email enumeration
  const successMsg = 'If an account exists with that email, a password reset link has been sent.';

  const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?')
    .bind(body.email.toLowerCase()).first<{ id: string; email: string; name: string }>();

  if (!user) {
    // Constant-time: still do work to prevent timing attacks
    await hashPassword('dummy-password-for-timing');
    return success(null, successMsg);
  }

  // Invalidate any existing reset tokens for this user
  await env.DB.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL")
    .bind(user.id).run();

  // Generate a secure reset token
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const resetToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Store the hash of the token (not the token itself)
  const tokenHash = await hashResetToken(resetToken, env.JWT_SECRET);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
  const id = generateId('prt');

  await env.DB.prepare(
    'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(id, user.id, tokenHash, expiresAt).run();

  // Send reset email
  const resetUrl = `https://ledger.weavehub.app/?reset_token=${resetToken}&email=${encodeURIComponent(user.email)}`;

  try {
    if (!env.SEND_EMAIL) return error('Email sending is not available on this deployment', 501);
    await env.SEND_EMAIL.send({
      from: 'WeaveLedger <noreply@business.weavehub.app>',
      to: user.email,
      subject: 'Reset your WeaveLedger password',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #1a2744; margin-bottom: 16px;">Password Reset</h2>
          <p style="color: #4a5568; line-height: 1.6;">Hi ${user.name},</p>
          <p style="color: #4a5568; line-height: 1.6;">We received a request to reset your WeaveLedger password. Click the button below to set a new password:</p>
          <a href="${resetUrl}" style="display: inline-block; background: #1a2744; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 16px 0;">Reset Password</a>
          <p style="color: #718096; font-size: 14px; line-height: 1.6;">This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
          <p style="color: #a0aec0; font-size: 12px;">WeaveLedger &mdash; Weave your finances together</p>
        </div>
      `,
      text: `Hi ${user.name},\n\nWe received a request to reset your WeaveLedger password. Open this link within 15 minutes:\n\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
    });
  } catch (e) {
    console.error('Failed to send reset email:', e);
    // Don't reveal email sending failures to prevent enumeration
  }

  return success(null, successMsg);
}

// Password Reset - Execute (validates token and sets new password)
export async function resetPassword(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ email: string; token: string; new_password: string }>();
  if (!body.email || !body.token || !body.new_password) {
    return error('Email, token, and new password are required');
  }

  if (body.new_password.length < 8 || body.new_password.length > 128) {
    return error('Password must be between 8 and 128 characters');
  }

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(body.email.toLowerCase()).first<{ id: string }>();

  if (!user) {
    return error('Invalid or expired reset token', 401);
  }

  // Find valid (unused, non-expired) reset tokens for this user
  const tokens = await env.DB.prepare(
    "SELECT id, token_hash, expires_at FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 5"
  ).bind(user.id).all<{ id: string; token_hash: string; expires_at: string }>();

  // Verify the token against stored hashes
  let matchedTokenId: string | null = null;
  const tokenHash = await hashResetToken(body.token, env.JWT_SECRET);

  for (const t of tokens.results) {
    if (tokenHash === t.token_hash) {
      matchedTokenId = t.id;
      break;
    }
  }

  if (!matchedTokenId) {
    return error('Invalid or expired reset token', 401);
  }

  // Mark token as used
  await env.DB.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?")
    .bind(matchedTokenId).run();

  // Update password, reset lockout, and invalidate all existing tokens
  const newHash = await hashPassword(body.new_password);
  await env.DB.prepare(
    "UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, token_version = COALESCE(token_version, 0) + 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(newHash, user.id).run();

  // Invalidate all refresh tokens on password reset
  await env.DB.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").bind(user.id).run();

  return success(null, 'Password reset successfully. You can now log in with your new password.');
}

// Refresh token rotation: validates a refresh token, issues a new JWT + new refresh token
export async function refreshAuth(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ refreshToken: string }>();
  if (!body.refreshToken) {
    return error('refreshToken is required');
  }

  const tokenHash = await hashRefreshToken(body.refreshToken, env.JWT_SECRET);

  // Find the refresh token
  const stored = await env.DB.prepare(
    "SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = ?"
  ).bind(tokenHash).first<{ id: string; user_id: string; expires_at: string }>();

  if (!stored) {
    return error('Invalid refresh token', 401);
  }

  // Check expiry
  if (new Date(stored.expires_at) < new Date()) {
    await env.DB.prepare("DELETE FROM refresh_tokens WHERE id = ?").bind(stored.id).run();
    return error('Refresh token expired', 401);
  }

  // Delete the used token (rotate on use)
  await env.DB.prepare("DELETE FROM refresh_tokens WHERE id = ?").bind(stored.id).run();

  // Look up the user
  const user = await env.DB.prepare(
    'SELECT id, email, role, token_version FROM users WHERE id = ?'
  ).bind(stored.user_id).first<{ id: string; email: string; role: string; token_version: number }>();

  if (!user) {
    return error('User not found', 401);
  }

  // Issue new JWT + new refresh token
  const newToken = await createJWT({ sub: user.id, email: user.email, role: user.role, tv: user.token_version || 0 }, env.JWT_SECRET);
  const newRefreshToken = await createRefreshToken();
  const newRefreshTokenHash = await hashRefreshToken(newRefreshToken, env.JWT_SECRET);
  const newRefreshId = generateId('rt');
  await env.DB.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash) VALUES (?, ?, ?)"
  ).bind(newRefreshId, user.id, newRefreshTokenHash).run();

  return json({ token: newToken, refreshToken: newRefreshToken });
}

// Hash a reset token with HMAC for storage
async function hashResetToken(token: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`reset:${token}`));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
