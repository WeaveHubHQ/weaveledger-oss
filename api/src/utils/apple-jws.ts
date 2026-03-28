/**
 * Shared Apple JWS utilities for WeaveLedger.
 *
 * Used by:
 *  - Apple subscription sync (cancellation detection via Server API)
 *  - App Store Server Notifications V2 webhook (paywall enforcement)
 *
 * Runs on Cloudflare Workers — Web Crypto API only, zero npm dependencies.
 */

// ---------------------------------------------------------------------------
// Apple Root CA G3 — DER-encoded, base64
// Source: https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
// SHA-256 fingerprint: 63343abfb89a6a03eb57132a82f79f1036c0718f55b7d1ceb2b22ab84ceefe82
// This certificate does NOT expire until 2039-02-20.
// ---------------------------------------------------------------------------
const APPLE_ROOT_CA_G3_BASE64 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS' +
  'QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u' +
  'IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN' +
  'MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS' +
  'b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y' +
  'aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49' +
  'AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf' +
  'TjjTuxxEtX/1H7v2CgNMgoYfQs6pFHErYSdU/QnxnAdK/L3RnFop4oIBlmSLIwrk' +
  'QJGAbnXnMxroFk+cpaNTMEEwHQYDVR0OBBYEFLuw3GKHGVMYnYewkb53BM39IYNh' +
  'MA8GA1UdEwEB/wQFMAMBAf8wDwYDVR0PAQH/BAUDAwcGADAKBggqhkjOPQQDAwNo' +
  'ADBlAjEAs12u0ppIBOh90Maa38rbV94wlhmEjJ/Tv/s3JE3MenNXn0HxCrCl1fAL' +
  'HJmo/BGfAjBUMV0F6sFLB/FJJqYHjD/4GJYsXKi3Qb64yMXbF5JmLZbOO3VOA+m' +
  'H0sLjM5fmyM=';

// ---------------------------------------------------------------------------
// Base64 helpers (URL-safe and standard)
// ---------------------------------------------------------------------------

/** Standard base64 decode to Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** URL-safe base64 encode from Uint8Array. */
function bytesToBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** URL-safe base64 encode from a JS object (JSON-serialised). */
function objectToBase64url(obj: unknown): string {
  return btoa(JSON.stringify(obj))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Decode a URL-safe base64 string to a UTF-8 string. */
function base64urlDecode(s: string): string {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  b64 += '='.repeat((4 - (b64.length % 4)) % 4);
  return atob(b64);
}

// ---------------------------------------------------------------------------
// DER / ASN.1 helpers
// ---------------------------------------------------------------------------

/**
 * Convert a DER-encoded ECDSA signature (as produced by Web Crypto) to the
 * fixed-length raw (r || s) format expected by JWS / JWT.
 *
 * DER layout:  0x30 <total-len> 0x02 <r-len> <r-bytes> 0x02 <s-len> <s-bytes>
 * Raw layout:  <r 32 bytes> <s 32 bytes>  (zero-padded on the left)
 */
export function derToRaw(der: Uint8Array): Uint8Array {
  const raw = new Uint8Array(64);
  let offset = 2; // skip SEQUENCE tag + length

  if (der[offset] !== 0x02) return der; // malformed — bail
  const rLen = der[offset + 1];
  const rStart = offset + 2;
  const rBytes = der.slice(rStart, rStart + rLen);

  offset = rStart + rLen;
  if (der[offset] !== 0x02) return der;
  const sLen = der[offset + 1];
  const sStart = offset + 2;
  const sBytes = der.slice(sStart, sStart + sLen);

  // Strip leading zero padding (DER uses it for sign), then right-align to 32 bytes.
  const rTrimmed = rBytes.length > 32 ? rBytes.slice(rBytes.length - 32) : rBytes;
  const sTrimmed = sBytes.length > 32 ? sBytes.slice(sBytes.length - 32) : sBytes;
  raw.set(rTrimmed, 32 - rTrimmed.length);
  raw.set(sTrimmed, 64 - sTrimmed.length);

  return raw;
}

/**
 * Convert a raw (r || s) ECDSA signature back to DER encoding.
 * Needed when calling crypto.subtle.verify which expects DER on some runtimes,
 * or when we receive raw and need DER.
 */
function rawToDer(raw: Uint8Array): Uint8Array {
  const r = raw.slice(0, 32);
  const s = raw.slice(32, 64);

  // DER integers must be positive — prepend 0x00 if high bit is set.
  const rDer = r[0] & 0x80 ? new Uint8Array([0x00, ...r]) : trimLeadingZeroes(r);
  const sDer = s[0] & 0x80 ? new Uint8Array([0x00, ...s]) : trimLeadingZeroes(s);

  const totalLen = 2 + rDer.length + 2 + sDer.length;
  const der = new Uint8Array(2 + totalLen);
  let offset = 0;
  der[offset++] = 0x30; // SEQUENCE
  der[offset++] = totalLen;
  der[offset++] = 0x02; // INTEGER
  der[offset++] = rDer.length;
  der.set(rDer, offset);
  offset += rDer.length;
  der[offset++] = 0x02; // INTEGER
  der[offset++] = sDer.length;
  der.set(sDer, offset);
  return der;
}

function trimLeadingZeroes(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  // Keep a leading zero if the high bit of the next byte is set (sign bit).
  if (bytes[start] & 0x80 && start > 0) start--;
  return bytes.slice(start);
}

// ---------------------------------------------------------------------------
// X.509 DER parsing helpers (minimal, targeted at extracting SPKI)
// ---------------------------------------------------------------------------

/**
 * Read an ASN.1 tag + length from `der` starting at `offset`.
 * Returns { tag, length, headerLen } where headerLen is the number of
 * bytes consumed by the tag + length encoding itself.
 */
function readAsn1TagLength(
  der: Uint8Array,
  offset: number
): { tag: number; length: number; headerLen: number } {
  const tag = der[offset];
  let length: number;
  let headerLen: number;

  if (der[offset + 1] < 0x80) {
    // Short form
    length = der[offset + 1];
    headerLen = 2;
  } else {
    // Long form
    const numBytes = der[offset + 1] & 0x7f;
    length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | der[offset + 2 + i];
    }
    headerLen = 2 + numBytes;
  }

  return { tag, length, headerLen };
}

/**
 * Walk the children of a SEQUENCE (tag 0x30) and return the byte offset
 * and length of each child element.
 */
function parseSequenceChildren(
  der: Uint8Array,
  seqBodyOffset: number,
  seqBodyLength: number
): Array<{ tag: number; offset: number; headerLen: number; length: number }> {
  const children: Array<{ tag: number; offset: number; headerLen: number; length: number }> = [];
  let pos = seqBodyOffset;
  const end = seqBodyOffset + seqBodyLength;

  while (pos < end) {
    const { tag, length, headerLen } = readAsn1TagLength(der, pos);
    children.push({ tag, offset: pos, headerLen, length });
    pos += headerLen + length;
  }

  return children;
}

/**
 * Extract the SubjectPublicKeyInfo (SPKI) DER block from an X.509
 * certificate encoded in DER.
 *
 * X.509 structure (simplified):
 *   Certificate ::= SEQUENCE {
 *     tbsCertificate       TBSCertificate,       -- SEQUENCE
 *     signatureAlgorithm   AlgorithmIdentifier,  -- SEQUENCE
 *     signatureValue       BIT STRING
 *   }
 *
 *   TBSCertificate ::= SEQUENCE {
 *     version         [0] EXPLICIT ...,
 *     serialNumber         INTEGER,
 *     signature            AlgorithmIdentifier,
 *     issuer               Name,
 *     validity             SEQUENCE,
 *     subject              Name,
 *     subjectPublicKeyInfo SubjectPublicKeyInfo,  -- <== what we want
 *     ...
 *   }
 *
 * The SPKI is the 7th element of TBSCertificate (index 6) when the
 * optional version [0] tag is present (it always is for v3 certs from Apple).
 */
function extractSpkiFromCert(certDer: Uint8Array): Uint8Array {
  // Outer SEQUENCE (Certificate)
  const cert = readAsn1TagLength(certDer, 0);
  if (cert.tag !== 0x30) throw new Error('Invalid X.509: expected SEQUENCE');

  const certChildren = parseSequenceChildren(certDer, cert.headerLen, cert.length);
  if (certChildren.length < 1) throw new Error('Invalid X.509: no TBSCertificate');

  // TBSCertificate SEQUENCE
  const tbs = certChildren[0];
  if (tbs.tag !== 0x30) throw new Error('Invalid X.509: TBSCertificate not SEQUENCE');
  const tbsChildren = parseSequenceChildren(
    certDer,
    tbs.offset + tbs.headerLen,
    tbs.length
  );

  // The SubjectPublicKeyInfo is at index 6 when version [0] is present.
  // version is tagged [0] (0xa0). If it's missing, SPKI moves to index 5.
  const hasExplicitVersion = tbsChildren.length > 0 && tbsChildren[0].tag === 0xa0;
  const spkiIndex = hasExplicitVersion ? 6 : 5;

  if (tbsChildren.length <= spkiIndex) {
    throw new Error('Invalid X.509: cannot locate SubjectPublicKeyInfo');
  }

  const spki = tbsChildren[spkiIndex];
  return certDer.slice(spki.offset, spki.offset + spki.headerLen + spki.length);
}

/**
 * Extract the raw signature bytes and the TBS (to-be-signed) data from
 * an X.509 certificate in DER format. Used for certificate chain validation.
 *
 * Returns:
 *  - tbsBytes: the DER-encoded TBSCertificate (the data that was signed)
 *  - signatureBytes: the raw signature (BIT STRING content, first byte stripped)
 *  - signatureAlgorithm: the OID bytes of the signature algorithm
 */
function extractCertSignatureComponents(certDer: Uint8Array): {
  tbsBytes: Uint8Array;
  signatureBytes: Uint8Array;
} {
  const cert = readAsn1TagLength(certDer, 0);
  const certChildren = parseSequenceChildren(certDer, cert.headerLen, cert.length);

  // TBSCertificate
  const tbs = certChildren[0];
  const tbsBytes = certDer.slice(tbs.offset, tbs.offset + tbs.headerLen + tbs.length);

  // signatureValue (BIT STRING) — third child of Certificate
  const sigValue = certChildren[2];
  // BIT STRING has a leading "unused bits" byte — skip it for the actual signature.
  const sigContentStart = sigValue.offset + sigValue.headerLen + 1; // +1 for unused-bits byte
  const signatureBytes = certDer.slice(sigContentStart, sigValue.offset + sigValue.headerLen + sigValue.length);

  return { tbsBytes, signatureBytes };
}

// ---------------------------------------------------------------------------
// JWS decoding (no verification)
// ---------------------------------------------------------------------------

/**
 * Decode a JWS payload WITHOUT verifying the signature.
 *
 * Use only for non-security-critical reads (e.g., peeking at a notification
 * type before deciding whether to process it). For any authorization or
 * trust decision, use {@link verifyAndDecodeJWS} instead.
 */
export function decodeJWSPayload(jws: string): Record<string, unknown> {
  const parts = jws.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWS: expected 3 dot-separated parts');
  }
  return JSON.parse(base64urlDecode(parts[1]));
}

// ---------------------------------------------------------------------------
// JWS signature verification with x5c certificate chain
// ---------------------------------------------------------------------------

/**
 * Verify an Apple-signed JWS (used by App Store Server Notifications V2
 * and the App Store Server API) and return the decoded payload.
 *
 * Verification steps:
 *  1. Parse the JWS header and extract the x5c certificate chain.
 *  2. Verify the chain:
 *     a. The root certificate in the chain must match the hardcoded Apple Root CA G3.
 *     b. The intermediate certificate must be signed by the root.
 *     c. The leaf certificate must be signed by the intermediate.
 *  3. Extract the leaf certificate's public key (SPKI).
 *  4. Verify the JWS signature over header.payload using that key.
 *  5. Return the decoded payload.
 *
 * Throws on any failure (malformed JWS, chain mismatch, bad signature).
 */
export async function verifyAndDecodeJWS(
  jws: string
): Promise<Record<string, unknown>> {
  // -- 1. Split JWS and parse header --
  const parts = jws.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWS: expected 3 dot-separated parts');
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64urlDecode(headerB64)) as {
    alg?: string;
    x5c?: string[];
  };

  if (header.alg !== 'ES256') {
    throw new Error(`Unsupported JWS algorithm: ${header.alg}`);
  }

  const x5c = header.x5c;
  if (!x5c || !Array.isArray(x5c) || x5c.length < 3) {
    throw new Error(
      'JWS header missing x5c certificate chain (need at least 3 certificates)'
    );
  }

  // Decode certificates from base64 DER
  const certsDer = x5c.map((c) => base64ToBytes(c));

  // -- 2. Validate the certificate chain --
  const leafDer = certsDer[0];
  const intermediateDer = certsDer[1];
  const rootDer = certsDer[certsDer.length - 1];

  // 2a. Root cert must match the pinned Apple Root CA G3
  const pinnedRoot = base64ToBytes(APPLE_ROOT_CA_G3_BASE64);
  if (!constantTimeEqual(rootDer, pinnedRoot)) {
    throw new Error(
      'x5c chain root certificate does not match Apple Root CA G3'
    );
  }

  // 2b. Verify intermediate is signed by the root
  await verifyCertSignature(intermediateDer, rootDer);

  // 2c. Verify leaf is signed by the intermediate
  await verifyCertSignature(leafDer, intermediateDer);

  // -- 3. Extract leaf public key --
  const leafSpki = extractSpkiFromCert(leafDer);
  const leafKey = await crypto.subtle.importKey(
    'spki',
    leafSpki.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );

  // -- 4. Verify JWS signature --
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  // Decode the JWS signature (URL-safe base64 → raw bytes)
  const rawSig = base64ToBytes(
    signatureB64.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (signatureB64.length % 4)) % 4)
  );

  // JWS ES256 uses raw (r||s) format. Web Crypto on Workers expects raw
  // format for P-256 verify when using { name: 'ECDSA', hash: 'SHA-256' }.
  // If the signature is DER-encoded (starts with 0x30), convert to raw first.
  let sigForVerify: Uint8Array;
  if (rawSig[0] === 0x30) {
    sigForVerify = derToRaw(rawSig);
  } else {
    sigForVerify = rawSig;
  }

  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    leafKey,
    sigForVerify.buffer,
    signingInput.buffer
  );

  if (!valid) {
    throw new Error('JWS signature verification failed');
  }

  // -- 5. Decode and return payload --
  return JSON.parse(base64urlDecode(payloadB64));
}

/**
 * Verify that `certDer` was signed by the key in `issuerDer`.
 * Both are DER-encoded X.509 certificates.
 *
 * Supports ECDSA with SHA-256 and SHA-384 (Apple uses P-256 for leaf/intermediate
 * and P-384 for the root CA G3).
 */
async function verifyCertSignature(
  certDer: Uint8Array,
  issuerDer: Uint8Array
): Promise<void> {
  // Extract issuer public key
  const issuerSpki = extractSpkiFromCert(issuerDer);

  // Determine curve from SPKI length heuristic:
  //   P-256 uncompressed public key = 65 bytes → SPKI ~91 bytes
  //   P-384 uncompressed public key = 97 bytes → SPKI ~120 bytes
  const curve = issuerSpki.length > 100 ? 'P-384' : 'P-256';
  const hash = curve === 'P-384' ? 'SHA-384' : 'SHA-256';

  const issuerKey = await crypto.subtle.importKey(
    'spki',
    issuerSpki.buffer,
    { name: 'ECDSA', namedCurve: curve },
    false,
    ['verify']
  );

  // Extract TBS and signature from the certificate being verified
  const { tbsBytes, signatureBytes } = extractCertSignatureComponents(certDer);

  // X.509 signature is DER-encoded. Web Crypto verify for ECDSA expects
  // the raw (r||s) format on Cloudflare Workers.
  const componentSize = curve === 'P-384' ? 48 : 32;
  const rawSig = derToRawN(signatureBytes, componentSize);

  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash },
    issuerKey,
    rawSig.buffer,
    tbsBytes.buffer
  );

  if (!valid) {
    throw new Error('Certificate chain verification failed: invalid issuer signature');
  }
}

/**
 * DER-to-raw for arbitrary component sizes (32 for P-256, 48 for P-384).
 */
function derToRawN(der: Uint8Array, n: number): Uint8Array {
  const raw = new Uint8Array(n * 2);
  let offset = 0;

  // If starts with SEQUENCE tag, skip it
  if (der[offset] === 0x30) {
    offset += 2;
    // Handle long form length
    if (der[1] & 0x80) offset += (der[1] & 0x7f);
  }

  if (der[offset] !== 0x02) return der;
  const rLen = der[offset + 1];
  const rStart = offset + 2;
  const rBytes = der.slice(rStart, rStart + rLen);

  offset = rStart + rLen;
  if (der[offset] !== 0x02) return der;
  const sLen = der[offset + 1];
  const sStart = offset + 2;
  const sBytes = der.slice(sStart, sStart + sLen);

  const rTrimmed = rBytes.length > n ? rBytes.slice(rBytes.length - n) : rBytes;
  const sTrimmed = sBytes.length > n ? sBytes.slice(sBytes.length - n) : sBytes;
  raw.set(rTrimmed, n - rTrimmed.length);
  raw.set(sTrimmed, n * 2 - sTrimmed.length);

  return raw;
}

/**
 * Constant-time comparison of two byte arrays.
 * Prevents timing side-channels when comparing certificates.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// JWT generation for Apple APIs
// ---------------------------------------------------------------------------

/** Credentials shape accepted by JWT generators. */
export interface AppleApiCredentials {
  issuer_id: string;
  key_id: string;
  private_key: string;
}

/**
 * Sign and return a JWT for the standard Apple APIs.
 *
 * Produces a standard ES256 JWT with:
 *   header:  { alg: "ES256", kid: <key_id>, typ: "JWT" }
 *   payload: { iss: <issuer_id>, iat, exp, aud: "appstoreconnect-v1" }
 *
 * Suitable for App Store Connect REST API, Sales & Trends, etc.
 */
async function signAppleJWT(
  creds: AppleApiCredentials,
  extraClaims?: Record<string, unknown>
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: creds.key_id, typ: 'JWT' };
  const payload: Record<string, unknown> = {
    iss: creds.issuer_id,
    iat: now,
    exp: now + 1200, // 20 minutes
    aud: 'appstoreconnect-v1',
    ...extraClaims,
  };

  const signingInput = `${objectToBase64url(header)}.${objectToBase64url(payload)}`;

  // Import the PKCS#8 private key
  const pemBody = creds.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyBytes = base64ToBytes(pemBody);

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );

  const rawSig = derToRaw(new Uint8Array(signatureBuffer));
  const encodedSig = bytesToBase64url(rawSig);

  return `${signingInput}.${encodedSig}`;
}

/**
 * Generate a JWT for the App Store Connect API (no bundle ID claim).
 *
 * Used for: Sales & Trends reports, App metadata, listing apps, etc.
 */
export async function getAppleJWT(
  creds: AppleApiCredentials
): Promise<string> {
  return signAppleJWT(creds);
}

/**
 * Generate a JWT for the App Store Server API, which requires a `bid`
 * (bundle ID) claim in the payload.
 *
 * Used for: Notification history, subscription status, transaction lookup.
 */
export async function getAppleServerJWT(
  creds: AppleApiCredentials,
  bundleId: string
): Promise<string> {
  return signAppleJWT(creds, { bid: bundleId });
}
