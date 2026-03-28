// TOTP (RFC 6238) implementation for Cloudflare Workers using Web Crypto

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

export function getOTPAuthURL(secret: string, email: string): string {
  const issuer = 'WeaveLedger';
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 1000);
  // Check current window and +/- 1 window for clock drift
  for (let offset = -1; offset <= 1; offset++) {
    const counter = Math.floor((now / 30) + offset);
    const expected = await generateTOTPCode(secret, counter);
    if (timingSafeEqual(code, expected)) return true;
  }
  return false;
}

async function generateTOTPCode(secret: string, counter: number): Promise<string> {
  const secretBytes = base32Decode(secret);
  const counterBytes = new ArrayBuffer(8);
  const view = new DataView(counterBytes);
  view.setBigUint64(0, BigInt(counter));

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

function base32Encode(bytes: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

function base32Decode(str: string): Uint8Array {
  const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
