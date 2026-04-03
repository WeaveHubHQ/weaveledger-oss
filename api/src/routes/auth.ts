import { Env } from '../types';
import { generateId, hashPassword, verifyPassword, createJWT, encryptValue, decryptValue, deriveDownloadKey, createRefreshToken, hashRefreshToken } from '../utils/crypto';
import { generateSecret, getOTPAuthURL, verifyTOTP } from '../utils/totp';
import { json, error, success } from '../utils/response';

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
    'SELECT id, email, name, role, mfa_enabled, ai_provider, anthropic_api_key, openai_api_key, subscription_tier, subscription_expires_at, created_at FROM users WHERE id = ?'
  ).bind(userId).first<Record<string, unknown>>();

  if (!user) return error('User not found', 404);

  const linkedEmails = await env.DB.prepare(
    'SELECT id, email, verified, created_at FROM user_emails WHERE user_id = ? ORDER BY created_at'
  ).bind(userId).all();

  return success({
    ...user,
    anthropic_api_key: user.anthropic_api_key ? true : false,
    openai_api_key: user.openai_api_key ? true : false,
    linked_emails: linkedEmails.results,
  });
}

// Linked email management for receipt capture
export async function addLinkedEmail(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ email: string }>();
  if (!body.email) return error('Email is required');

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) return error('Invalid email address');

  const email = body.email.toLowerCase();

  // Check it's not already a primary account email
  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existingUser) return error('This email is already a primary account email', 409);

  // Check it's not already linked
  const existingLink = await env.DB.prepare('SELECT id FROM user_emails WHERE email = ?').bind(email).first();
  if (existingLink) return error('This email is already linked to an account', 409);

  // Generate a 6-digit verification code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  // Only allow linking emails from the same domain as the user's primary email
  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (!user) return error('User not found', 404);

  const primaryDomain = user.email.split('@')[1];
  const linkedDomain = email.split('@')[1];
  if (primaryDomain !== linkedDomain) {
    return error(`Only emails from @${primaryDomain} can be linked. Email verification for other domains is not yet available.`);
  }

  const id = generateId('ue');
  await env.DB.prepare(
    'INSERT INTO user_emails (id, user_id, email, verification_code, verification_expires) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, email, code, expires).run();

  // Auto-verify same-domain emails ONLY for private/custom domains (not public providers)
  const PUBLIC_EMAIL_DOMAINS = [
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
    'protonmail.com', 'proton.me', 'zoho.com', 'mail.com', 'gmx.com', 'gmx.net',
    'fastmail.com', 'tutanota.com', 'tuta.com', 'hey.com', 'pm.me',
  ];
  if (PUBLIC_EMAIL_DOMAINS.includes(primaryDomain.toLowerCase())) {
    return success({ id, email, verified: false }, 'Email linked. Verification is required — check your inbox for the verification code.');
  }

  // Custom/private domain — auto-verify (trusted since user already verified primary on same domain)
  await env.DB.prepare(
    'UPDATE user_emails SET verified = 1, verification_code = NULL WHERE id = ?'
  ).bind(id).run();

  return success({ id, email, verified: true }, 'Email linked successfully. Receipts sent from this address will be attributed to your account.');
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
  const body = await request.json<{ ai_provider?: string; anthropic_api_key?: string | null; openai_api_key?: string | null }>();

  if (body.ai_provider !== undefined) {
    const valid = ['anthropic', 'openai'];
    if (!valid.includes(body.ai_provider)) {
      return error('Invalid AI provider. Must be: anthropic or openai.');
    }
    await env.DB.prepare(
      "UPDATE users SET ai_provider = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.ai_provider, userId).run();
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

  // Send reset email — use APP_URL if set, fall back to the hosted web app
  const appBase = (env as any).APP_URL || 'https://ledger.weavehub.app';
  const resetUrl = `${appBase}/?reset_token=${resetToken}&email=${encodeURIComponent(user.email)}`;

  try {
    await env.SEND_EMAIL.send({
      from: { name: 'WeaveLedger', email: 'noreply@weavehub.app' },
      to: [{ email: user.email }],
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
