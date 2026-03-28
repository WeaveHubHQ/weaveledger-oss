import { JWTPayload } from '../types';

export function generateId(prefix: string = ''): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex}` : hex;
}

async function pbkdf2Hash(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = await pbkdf2Hash(password, salt, 100000);
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  let saltHex: string, storedHash: string;

  if (stored.startsWith('v2:')) {
    // v2 format used 600k iterations which CF Workers no longer supports
    throw new Error('PASSWORD_RESET_REQUIRED');
  }

  // v1 format: salt:hash (100k iterations)
  [saltHex, storedHash] = stored.split(':');

  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const hashHex = await pbkdf2Hash(password, salt, 100000);

  // Constant-time comparison to prevent timing attacks
  if (hashHex.length !== storedHash.length) return false;
  const a = new TextEncoder().encode(hashHex);
  const b = new TextEncoder().encode(storedHash);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function createRefreshToken(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashRefreshToken(token: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`refresh:${token}`));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string, expiresInHours: number = 2): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + (expiresInHours * 3600),
  };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(fullPayload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${signingInput}.${encodedSignature}`;
}

// AES-GCM encryption for storing API keys
// v2 uses per-context salt; v1 (legacy) used a static salt
async function deriveEncryptionKey(secret: string, salt?: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const saltStr = salt ? `weaveledger:${salt}` : 'weaveledger-api-keys';
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode(saltStr), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptValue(plaintext: string, secret: string, context?: string): Promise<string> {
  const key = await deriveEncryptionKey(secret, context);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  const ctHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');
  // v2 prefix indicates per-context salt was used
  return context ? `v2:${ivHex}:${ctHex}` : `${ivHex}:${ctHex}`;
}

export async function decryptValue(encrypted: string, secret: string, context?: string): Promise<string> {
  let ivHex: string, ctHex: string, salt: string | undefined;

  if (encrypted.startsWith('v2:')) {
    // v2 format: v2:iv:ciphertext (uses per-context salt)
    const parts = encrypted.split(':');
    ivHex = parts[1];
    ctHex = parts[2];
    salt = context;
  } else {
    // v1 format: iv:ciphertext (uses static salt — backward compatible)
    [ivHex, ctHex] = encrypted.split(':');
    salt = undefined;
  }

  const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const ciphertext = new Uint8Array(ctHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const key = await deriveEncryptionKey(secret, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// Derive a separate HMAC key for download tokens so JWT_SECRET is not directly used
export async function deriveDownloadKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', baseKey, encoder.encode('weaveledger:download-tokens'));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signatureBytes = Uint8Array.from(atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(signingInput));
    if (!valid) return null;
    const payload: JWTPayload = JSON.parse(atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
