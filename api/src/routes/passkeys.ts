// Passkey (WebAuthn) endpoints — registration + authentication ceremonies.
//
// rpId is derived from the request host so the same worker serves
// ledger.weavehub.app, hosted *.weaveledger.app tenants, and self-hosted
// domains without configuration. The expected origin is https://<rpId>,
// which matches both browsers and iOS ASAuthorization clients.
//
// A successful passkey login bypasses the TOTP prompt: possession of the
// credential plus on-device user verification (Face ID / Touch ID / PIN)
// already constitutes two factors.

import { Env } from '../types';
import { generateId, createJWT, createRefreshToken, hashRefreshToken } from '../utils/crypto';
import { json, error, success } from '../utils/response';
import {
  b64urlEncode, b64urlDecode, randomChallenge, cborDecode, parseAuthenticatorData,
  coseToJwk, verifyWebAuthnSignature, validateClientData, bytesEqual, sha256,
  COSE_ALG_ES256, COSE_ALG_RS256,
} from '../utils/webauthn';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CREDENTIALS_PER_USER = 10;
const MAX_NICKNAME_LENGTH = 60;
// Ceiling on any base64url ceremony field — attestation objects run ~1KB;
// 16KB leaves generous headroom while bounding decode cost.
const MAX_FIELD_LENGTH = 16 * 1024;

function fieldsTooLarge(...fields: (string | null | undefined)[]): boolean {
  return fields.some(f => typeof f === 'string' && f.length > MAX_FIELD_LENGTH);
}

function rpIdFromRequest(request: Request): string {
  return new URL(request.url).hostname;
}

// Browsers put scheme://host[:port] in clientDataJSON.origin. Deriving from the
// request URL keeps production strict (https://<host>) while letting
// `wrangler dev` on http://localhost work for local testing.
function expectedOrigin(request: Request): string {
  return new URL(request.url).origin;
}

async function storeChallenge(env: Env, challenge: string, type: 'registration' | 'authentication', userId: string | null): Promise<string> {
  const id = generateId('wch');
  const expires = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  await env.DB.prepare(
    'INSERT INTO webauthn_challenges (id, challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, challenge, userId, type, expires).run();
  // Opportunistic cleanup so the table never accumulates stale rows.
  await env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at < datetime('now', '-1 hour')").run();
  return id;
}

// Consumes (deletes) the challenge row — single use.
async function consumeChallenge(env: Env, challengeId: string, type: 'registration' | 'authentication'): Promise<{ challenge: string; user_id: string | null } | null> {
  const row = await env.DB.prepare(
    'SELECT challenge, user_id, expires_at FROM webauthn_challenges WHERE id = ? AND type = ?'
  ).bind(challengeId, type).first<{ challenge: string; user_id: string | null; expires_at: string }>();
  if (!row) return null;
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(challengeId).run();
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { challenge: row.challenge, user_id: row.user_id };
}

// POST /api/auth/passkeys/register/options (authenticated)
export async function passkeyRegisterOptions(request: Request, env: Env, userId: string): Promise<Response> {
  const user = await env.DB.prepare('SELECT email, name FROM users WHERE id = ?')
    .bind(userId).first<{ email: string; name: string }>();
  if (!user) return error('User not found', 404);

  const count = await env.DB.prepare('SELECT COUNT(*) as n FROM webauthn_credentials WHERE user_id = ?')
    .bind(userId).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_CREDENTIALS_PER_USER) {
    return error(`You can register up to ${MAX_CREDENTIALS_PER_USER} passkeys. Remove one first.`, 400);
  }

  const existing = await env.DB.prepare('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?')
    .bind(userId).all<{ credential_id: string; transports: string | null }>();

  const rpId = rpIdFromRequest(request);
  const challenge = randomChallenge();
  const challengeId = await storeChallenge(env, challenge, 'registration', userId);

  return success({
    challenge_id: challengeId,
    publicKey: {
      rp: { id: rpId, name: 'WeaveLedger' },
      user: {
        id: b64urlEncode(new TextEncoder().encode(userId)),
        name: user.email,
        displayName: user.name || user.email,
      },
      challenge,
      pubKeyCredParams: [
        { type: 'public-key', alg: COSE_ALG_ES256 },
        { type: 'public-key', alg: COSE_ALG_RS256 },
      ],
      timeout: 300000,
      excludeCredentials: existing.results.map(c => ({
        type: 'public-key',
        id: c.credential_id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      attestation: 'none',
    },
  });
}

interface RegisterVerifyBody {
  challenge_id: string;
  nickname?: string;
  credential: {
    id: string; // base64url credential ID
    response: {
      clientDataJSON: string;      // base64url
      attestationObject: string;   // base64url
      transports?: string[];
    };
  };
}

// POST /api/auth/passkeys/register/verify (authenticated)
export async function passkeyRegisterVerify(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<RegisterVerifyBody>();
  if (!body.challenge_id || !body.credential?.id || !body.credential.response?.clientDataJSON || !body.credential.response?.attestationObject) {
    return error('challenge_id and credential are required');
  }
  if (fieldsTooLarge(body.credential.id, body.credential.response.clientDataJSON, body.credential.response.attestationObject)) {
    return error('Credential payload too large', 400);
  }

  const stored = await consumeChallenge(env, body.challenge_id, 'registration');
  if (!stored || stored.user_id !== userId) {
    return error('Registration challenge is invalid or expired. Try again.', 400);
  }

  const rpId = rpIdFromRequest(request);
  const clientDataJSON = b64urlDecode(body.credential.response.clientDataJSON);
  const clientDataError = validateClientData(clientDataJSON, {
    type: 'webauthn.create',
    expectedChallenge: stored.challenge,
    expectedOrigin: expectedOrigin(request),
  });
  if (clientDataError) return error(clientDataError, 400);

  let attestation: unknown;
  try {
    attestation = cborDecode(b64urlDecode(body.credential.response.attestationObject));
  } catch {
    return error('Could not parse attestation object', 400);
  }
  if (!(attestation instanceof Map)) return error('Malformed attestation object', 400);

  const authDataBytes = attestation.get('authData');
  if (!(authDataBytes instanceof Uint8Array)) return error('Attestation object missing authData', 400);

  let authData;
  try {
    authData = parseAuthenticatorData(authDataBytes);
  } catch (e) {
    return error(e instanceof Error ? e.message : 'Invalid authenticator data', 400);
  }

  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  if (!bytesEqual(authData.rpIdHash, rpIdHash)) return error('rpId hash mismatch', 400);
  if (!authData.userPresent) return error('User presence flag not set', 400);
  if (!authData.userVerified) return error('User verification is required for passkeys', 400);
  if (!authData.attestedCredentialData || !authData.credentialId || !authData.cosePublicKey) {
    return error('Attested credential data missing', 400);
  }

  const credentialId = b64urlEncode(authData.credentialId);
  if (credentialId !== body.credential.id) return error('Credential ID mismatch', 400);

  let publicKey;
  try {
    publicKey = coseToJwk(authData.cosePublicKey);
  } catch (e) {
    return error(e instanceof Error ? e.message : 'Unsupported credential public key', 400);
  }

  const duplicate = await env.DB.prepare('SELECT id FROM webauthn_credentials WHERE credential_id = ?')
    .bind(credentialId).first();
  if (duplicate) return error('This passkey is already registered', 409);

  // Re-check the per-user cap at insert time — concurrent ceremonies could
  // each have passed the options-time check.
  const count = await env.DB.prepare('SELECT COUNT(*) as n FROM webauthn_credentials WHERE user_id = ?')
    .bind(userId).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_CREDENTIALS_PER_USER) {
    return error(`You can register up to ${MAX_CREDENTIALS_PER_USER} passkeys. Remove one first.`, 400);
  }

  const nickname = (typeof body.nickname === 'string' ? body.nickname : '').trim().slice(0, MAX_NICKNAME_LENGTH) || null;
  const transports = Array.isArray(body.credential.response.transports)
    ? JSON.stringify(body.credential.response.transports.slice(0, 8).map(t => String(t).slice(0, 20)))
    : null;

  const id = generateId('pk');
  await env.DB.prepare(
    `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, algorithm, sign_count, transports, nickname)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, credentialId, JSON.stringify(publicKey.jwk), publicKey.algorithm, authData.signCount, transports, nickname).run();

  return success(
    { id, credential_id: credentialId, nickname, created_at: new Date().toISOString() },
    'Passkey registered',
  );
}

// POST /api/auth/passkeys/login/options (public, rate limited)
export async function passkeyLoginOptions(request: Request, env: Env): Promise<Response> {
  const rpId = rpIdFromRequest(request);
  const challenge = randomChallenge();
  const challengeId = await storeChallenge(env, challenge, 'authentication', null);

  return success({
    challenge_id: challengeId,
    publicKey: {
      challenge,
      rpId,
      timeout: 300000,
      userVerification: 'required',
      // Discoverable credentials: no allowCredentials — the authenticator
      // offers whichever passkeys it holds for this rpId.
      allowCredentials: [],
    },
  });
}

interface LoginVerifyBody {
  challenge_id: string;
  credential: {
    id: string; // base64url credential ID
    response: {
      clientDataJSON: string;     // base64url
      authenticatorData: string;  // base64url
      signature: string;          // base64url
      userHandle?: string | null; // base64url
    };
  };
}

// POST /api/auth/passkeys/login/verify (public, rate limited)
// On success: same response shape as password login. TOTP is never prompted.
export async function passkeyLoginVerify(request: Request, env: Env): Promise<Response> {
  const body = await request.json<LoginVerifyBody>();
  if (!body.challenge_id || !body.credential?.id || !body.credential.response?.clientDataJSON
      || !body.credential.response?.authenticatorData || !body.credential.response?.signature) {
    return error('challenge_id and credential are required');
  }
  if (fieldsTooLarge(body.credential.id, body.credential.response.clientDataJSON,
      body.credential.response.authenticatorData, body.credential.response.signature,
      body.credential.response.userHandle)) {
    return error('Credential payload too large', 400);
  }

  const stored = await consumeChallenge(env, body.challenge_id, 'authentication');
  if (!stored) return error('Sign-in challenge is invalid or expired. Try again.', 400);

  const rpId = rpIdFromRequest(request);
  const clientDataJSON = b64urlDecode(body.credential.response.clientDataJSON);
  const clientDataError = validateClientData(clientDataJSON, {
    type: 'webauthn.get',
    expectedChallenge: stored.challenge,
    expectedOrigin: expectedOrigin(request),
  });
  if (clientDataError) return error(clientDataError, 400);

  const credential = await env.DB.prepare(
    'SELECT id, user_id, public_key, algorithm, sign_count FROM webauthn_credentials WHERE credential_id = ?'
  ).bind(body.credential.id).first<{ id: string; user_id: string; public_key: string; algorithm: number; sign_count: number }>();
  if (!credential) return error('Passkey not recognized', 401);

  // If the authenticator supplied a userHandle, it must match the credential's owner.
  if (body.credential.response.userHandle) {
    const handle = new TextDecoder().decode(b64urlDecode(body.credential.response.userHandle));
    if (handle !== credential.user_id) return error('Passkey not recognized', 401);
  }

  const authDataBytes = b64urlDecode(body.credential.response.authenticatorData);
  let authData;
  try {
    authData = parseAuthenticatorData(authDataBytes);
  } catch {
    return error('Invalid authenticator data', 400);
  }

  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  if (!bytesEqual(authData.rpIdHash, rpIdHash)) return error('rpId hash mismatch', 400);
  if (!authData.userPresent) return error('User presence flag not set', 400);
  if (!authData.userVerified) return error('User verification is required', 400);

  const valid = await verifyWebAuthnSignature(
    { jwk: JSON.parse(credential.public_key), algorithm: credential.algorithm },
    authDataBytes,
    clientDataJSON,
    b64urlDecode(body.credential.response.signature),
  );
  if (!valid) return error('Passkey verification failed', 401);

  const user = await env.DB.prepare(
    'SELECT id, email, name, role, locked_until, token_version FROM users WHERE id = ?'
  ).bind(credential.user_id).first<{ id: string; email: string; name: string; role: string; locked_until: string | null; token_version: number }>();
  if (!user) return error('Passkey not recognized', 401);

  // Respect account lockout (set by failed password attempts).
  if (user.locked_until) {
    const lockedUntil = new Date(user.locked_until + 'Z').getTime();
    if (Date.now() < lockedUntil) {
      const minutesLeft = Math.ceil((lockedUntil - Date.now()) / 60000);
      return error(`Account locked. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`, 423);
    }
  }

  // Sign-count regression suggests a cloned credential. Passkeys synced via
  // iCloud/Google legitimately report 0 forever, so only flag when the stored
  // counter was ever positive.
  if (authData.signCount > 0 || credential.sign_count > 0) {
    if (authData.signCount <= credential.sign_count && credential.sign_count > 0) {
      console.warn(`[Passkeys] sign_count regression for credential ${credential.id}: stored=${credential.sign_count} presented=${authData.signCount}`);
    }
  }

  await env.DB.prepare(
    "UPDATE webauthn_credentials SET sign_count = ?, last_used_at = datetime('now') WHERE id = ?"
  ).bind(Math.max(authData.signCount, credential.sign_count), credential.id).run();

  // Passkey login clears the password-failure counter like a successful password login.
  await env.DB.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();

  const token = await createJWT({ sub: user.id, email: user.email, role: user.role, tv: user.token_version || 0 }, env.JWT_SECRET);
  const refreshToken = await createRefreshToken();
  const refreshTokenHash = await hashRefreshToken(refreshToken, env.JWT_SECRET);
  await env.DB.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash) VALUES (?, ?, ?)')
    .bind(generateId('rt'), user.id, refreshTokenHash).run();

  return json({ token, refreshToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}

// GET /api/auth/passkeys (authenticated)
export async function listPasskeys(request: Request, env: Env, userId: string): Promise<Response> {
  const rows = await env.DB.prepare(
    'SELECT id, nickname, transports, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at'
  ).bind(userId).all<{ id: string; nickname: string | null; transports: string | null; created_at: string; last_used_at: string | null }>();

  return success(rows.results.map(r => ({
    ...r,
    transports: r.transports ? JSON.parse(r.transports) : [],
  })));
}

// PATCH /api/auth/passkeys/:id (authenticated) — rename
export async function renamePasskey(request: Request, env: Env, userId: string, passkeyId: string): Promise<Response> {
  const body = await request.json<{ nickname?: string }>();
  const nickname = (typeof body.nickname === 'string' ? body.nickname : '').trim().slice(0, MAX_NICKNAME_LENGTH) || null;

  const result = await env.DB.prepare(
    'UPDATE webauthn_credentials SET nickname = ? WHERE id = ? AND user_id = ?'
  ).bind(nickname, passkeyId, userId).run();

  if (!result.meta.changes) return error('Passkey not found', 404);
  return success({ id: passkeyId, nickname }, 'Passkey renamed');
}

// DELETE /api/auth/passkeys/:id (authenticated)
export async function deletePasskey(request: Request, env: Env, userId: string, passkeyId: string): Promise<Response> {
  const result = await env.DB.prepare(
    'DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?'
  ).bind(passkeyId, userId).run();

  if (!result.meta.changes) return error('Passkey not found', 404);
  return success(null, 'Passkey removed. Also delete it from your device\'s password manager.');
}
