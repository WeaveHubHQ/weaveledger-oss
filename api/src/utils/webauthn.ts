// WebAuthn ceremony verification built on Web Crypto — no dependencies.
//
// Scope (passkey policy: attestation "none"): parse the authenticator data and
// COSE public key out of registration responses, and verify assertion
// signatures on login. Attestation statement chains are intentionally not
// verified — for consumer passkeys the trust anchor is the user's platform
// authenticator, and requiring attestation breaks iCloud Keychain / Google
// Password Manager credentials.
//
// Supported algorithms: ES256 (COSE -7, required) and RS256 (COSE -257).

export const COSE_ALG_ES256 = -7;
export const COSE_ALG_RS256 = -257;

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

// ---------------------------------------------------------------------------
// Minimal CBOR decoder — covers the subset attestation objects and COSE keys
// use: unsigned/negative ints, byte strings, text strings, arrays, and maps.
// ---------------------------------------------------------------------------

class CborReader {
  private view: DataView;
  private offset = 0;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  read(): unknown {
    const initial = this.readByte();
    const majorType = initial >> 5;
    const additional = initial & 0x1f;

    switch (majorType) {
      case 0: // unsigned int
        return this.readLength(additional);
      case 1: // negative int
        return -1 - this.readLength(additional);
      case 2: { // byte string
        const len = this.readLength(additional);
        return this.readBytes(len);
      }
      case 3: { // text string
        const len = this.readLength(additional);
        return new TextDecoder().decode(this.readBytes(len));
      }
      case 4: { // array
        const len = this.readLength(additional);
        const arr: unknown[] = [];
        for (let i = 0; i < len; i++) arr.push(this.read());
        return arr;
      }
      case 5: { // map
        const len = this.readLength(additional);
        const map = new Map<unknown, unknown>();
        for (let i = 0; i < len; i++) {
          const key = this.read();
          map.set(key, this.read());
        }
        return map;
      }
      case 7: // simple values
        if (additional === 20) return false;
        if (additional === 21) return true;
        if (additional === 22) return null;
        throw new Error(`Unsupported CBOR simple value: ${additional}`);
      default:
        throw new Error(`Unsupported CBOR major type: ${majorType}`);
    }
  }

  private readByte(): number {
    if (this.offset >= this.bytes.length) throw new Error('CBOR: unexpected end of input');
    return this.bytes[this.offset++];
  }

  private readBytes(len: number): Uint8Array {
    if (this.offset + len > this.bytes.length) throw new Error('CBOR: unexpected end of input');
    const out = this.bytes.slice(this.offset, this.offset + len);
    this.offset += len;
    return out;
  }

  private readLength(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 24) return this.readByte();
    if (additional === 25) {
      const v = this.view.getUint16(this.offset);
      this.offset += 2;
      return v;
    }
    if (additional === 26) {
      const v = this.view.getUint32(this.offset);
      this.offset += 4;
      return v;
    }
    throw new Error('CBOR: lengths beyond 32 bits are not supported');
  }
}

export function cborDecode(bytes: Uint8Array): unknown {
  return new CborReader(bytes).read();
}

// ---------------------------------------------------------------------------
// Authenticator data
// ---------------------------------------------------------------------------

export interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  userPresent: boolean;
  userVerified: boolean;
  attestedCredentialData: boolean;
  signCount: number;
  credentialId?: Uint8Array;
  cosePublicKey?: Map<unknown, unknown>;
}

export function parseAuthenticatorData(bytes: Uint8Array): ParsedAuthenticatorData {
  if (bytes.length < 37) throw new Error('Authenticator data too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const flags = bytes[32];
  const parsed: ParsedAuthenticatorData = {
    rpIdHash: bytes.slice(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    attestedCredentialData: (flags & 0x40) !== 0,
    signCount: view.getUint32(33),
  };

  if (parsed.attestedCredentialData) {
    if (bytes.length < 55) throw new Error('Attested credential data too short');
    const credIdLen = view.getUint16(53);
    const credIdEnd = 55 + credIdLen;
    if (bytes.length < credIdEnd) throw new Error('Credential ID truncated');
    parsed.credentialId = bytes.slice(55, credIdEnd);
    const coseBytes = bytes.slice(credIdEnd);
    const cose = cborDecode(coseBytes);
    if (!(cose instanceof Map)) throw new Error('COSE public key is not a CBOR map');
    parsed.cosePublicKey = cose;
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// COSE key → JWK
// ---------------------------------------------------------------------------

export interface CredentialPublicKey {
  jwk: JsonWebKey;
  algorithm: number; // COSE alg: -7 (ES256) or -257 (RS256)
}

export function coseToJwk(cose: Map<unknown, unknown>): CredentialPublicKey {
  const kty = cose.get(1) as number;
  const alg = cose.get(3) as number;

  if (kty === 2) {
    // EC2 — require P-256 + ES256
    if (alg !== COSE_ALG_ES256) throw new Error(`Unsupported EC algorithm: ${alg}`);
    const crv = cose.get(-1) as number;
    if (crv !== 1) throw new Error(`Unsupported EC curve: ${crv}`);
    const x = cose.get(-2) as Uint8Array;
    const y = cose.get(-3) as Uint8Array;
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) {
      throw new Error('Invalid EC public key coordinates');
    }
    return {
      jwk: { kty: 'EC', crv: 'P-256', x: b64urlEncode(x), y: b64urlEncode(y) },
      algorithm: COSE_ALG_ES256,
    };
  }

  if (kty === 3) {
    // RSA — require RS256
    if (alg !== COSE_ALG_RS256) throw new Error(`Unsupported RSA algorithm: ${alg}`);
    const n = cose.get(-1) as Uint8Array;
    const e = cose.get(-2) as Uint8Array;
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
      throw new Error('Invalid RSA public key parameters');
    }
    // 2048–4096-bit modulus only — bounds CPU cost of later verifications.
    if (n.length < 256 || n.length > 512 || e.length > 8) {
      throw new Error('RSA public key size out of range');
    }
    return {
      jwk: { kty: 'RSA', n: b64urlEncode(n), e: b64urlEncode(e) },
      algorithm: COSE_ALG_RS256,
    };
  }

  throw new Error(`Unsupported COSE key type: ${kty}`);
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

// WebAuthn ES256 signatures are ASN.1 DER; Web Crypto expects raw r||s.
function derToRawEcdsa(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('Invalid DER signature');
  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f; // long-form length

  const readInt = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new Error('Invalid DER integer');
    const len = der[offset + 1];
    let start = offset + 2;
    let intLen = len;
    // Strip leading zero padding
    while (intLen > 32 && der[start] === 0x00) {
      start++;
      intLen--;
    }
    if (intLen > 32) throw new Error('DER integer too long for P-256');
    offset = offset + 2 + len;
    const out = new Uint8Array(32);
    out.set(der.slice(start, start + intLen), 32 - intLen);
    return out;
  };

  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

export async function verifyWebAuthnSignature(
  publicKey: CredentialPublicKey,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const clientDataHash = await sha256(clientDataJSON);
  const message = new Uint8Array(authenticatorData.length + clientDataHash.length);
  message.set(authenticatorData, 0);
  message.set(clientDataHash, authenticatorData.length);

  try {
    if (publicKey.algorithm === COSE_ALG_ES256) {
      const key = await crypto.subtle.importKey(
        'jwk', publicKey.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
      );
      const rawSig = derToRawEcdsa(signature);
      return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, rawSig as BufferSource, message as BufferSource);
    }
    if (publicKey.algorithm === COSE_ALG_RS256) {
      const key = await crypto.subtle.importKey(
        'jwk', { ...publicKey.jwk, alg: 'RS256' }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
      );
      return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature as BufferSource, message as BufferSource);
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// clientDataJSON validation
// ---------------------------------------------------------------------------

export interface ClientDataCheck {
  type: 'webauthn.create' | 'webauthn.get';
  expectedChallenge: string; // base64url
  expectedOrigin: string;    // e.g. https://ledger.weavehub.app
}

export function validateClientData(clientDataJSON: Uint8Array, check: ClientDataCheck): string | null {
  let parsed: { type?: string; challenge?: string; origin?: string };
  try {
    parsed = JSON.parse(new TextDecoder().decode(clientDataJSON));
  } catch {
    return 'clientDataJSON is not valid JSON';
  }
  if (parsed.type !== check.type) return `Unexpected clientData type: ${parsed.type}`;
  if (parsed.challenge !== check.expectedChallenge) return 'Challenge mismatch';
  if (parsed.origin !== check.expectedOrigin) return `Unexpected origin: ${parsed.origin}`;
  return null;
}

// Constant-time-ish comparison for 32-byte hashes.
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
