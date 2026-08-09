// Unit verification for utils/webauthn.ts — run with: bun scripts/test-webauthn.ts
//
// Generates real P-256 and RSA keypairs via WebCrypto, builds synthetic
// authenticator data / clientDataJSON, signs them the way an authenticator
// would (ES256 signatures DER-encoded), and verifies through the production
// code paths, including negative cases.

import {
  b64urlEncode, b64urlDecode, cborDecode, parseAuthenticatorData, coseToJwk,
  verifyWebAuthnSignature, validateClientData, bytesEqual, sha256,
  COSE_ALG_ES256, COSE_ALG_RS256,
} from '../src/utils/webauthn';

let failures = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}

// --- helpers -----------------------------------------------------------------

function cborEncodeCose(entries: [number, number | Uint8Array][]): Uint8Array {
  // Minimal CBOR encoder for COSE key maps (int keys, int or bstr values).
  const parts: number[] = [];
  const pushInt = (major: number, value: number) => {
    if (value < 24) parts.push((major << 5) | value);
    else if (value < 256) parts.push((major << 5) | 24, value);
    else parts.push((major << 5) | 25, value >> 8, value & 0xff);
  };
  pushInt(5, entries.length);
  for (const [k, v] of entries) {
    if (k >= 0) pushInt(0, k); else pushInt(1, -1 - k);
    if (typeof v === 'number') {
      if (v >= 0) pushInt(0, v); else pushInt(1, -1 - v);
    } else {
      pushInt(2, v.length);
      parts.push(...v);
    }
  }
  return new Uint8Array(parts);
}

async function buildAuthData(rpId: string, opts: { signCount?: number; uv?: boolean; credentialId?: Uint8Array; coseKey?: Uint8Array }): Promise<Uint8Array> {
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const attested = !!(opts.credentialId && opts.coseKey);
  let flags = 0x01; // UP
  if (opts.uv !== false) flags |= 0x04; // UV
  if (attested) flags |= 0x40; // AT
  const head = new Uint8Array(37);
  head.set(rpIdHash, 0);
  head[32] = flags;
  new DataView(head.buffer).setUint32(33, opts.signCount ?? 0);
  if (!attested) return head;

  const aaguid = new Uint8Array(16);
  const credId = opts.credentialId!;
  const credLen = new Uint8Array(2);
  new DataView(credLen.buffer).setUint16(0, credId.length);
  const out = new Uint8Array(head.length + 16 + 2 + credId.length + opts.coseKey!.length);
  let o = 0;
  for (const part of [head, aaguid, credLen, credId, opts.coseKey!]) { out.set(part, o); o += part.length; }
  return out;
}

// Convert WebCrypto raw r||s ECDSA signature to DER (what authenticators emit).
function rawToDerEcdsa(raw: Uint8Array): Uint8Array {
  const encodeInt = (bytes: Uint8Array): number[] => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = Array.from(bytes.slice(i));
    if (v[0] & 0x80) v = [0, ...v];
    return [0x02, v.length, ...v];
  };
  const r = encodeInt(raw.slice(0, 32));
  const s = encodeInt(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

// --- tests -------------------------------------------------------------------

async function main() {
  const rpId = 'ledger.weavehub.app';
  const origin = `https://${rpId}`;

  // base64url round trip
  const rand = crypto.getRandomValues(new Uint8Array(57));
  check('b64url round-trip', bytesEqual(b64urlDecode(b64urlEncode(rand)), rand));

  // ES256 -------------------------------------------------------------------
  const ecPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const ecJwk = await crypto.subtle.exportKey('jwk', ecPair.publicKey);
  const x = b64urlDecode(ecJwk.x!);
  const y = b64urlDecode(ecJwk.y!);
  const ecCose = cborEncodeCose([[1, 2], [3, COSE_ALG_ES256], [-1, 1], [-2, x], [-3, y]]);

  // COSE→JWK
  const decoded = cborDecode(ecCose);
  const converted = coseToJwk(decoded as Map<unknown, unknown>);
  check('COSE→JWK ES256', converted.algorithm === COSE_ALG_ES256 && converted.jwk.x === ecJwk.x && converted.jwk.y === ecJwk.y);

  // Registration parse: authData with attested credential data
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const regAuthData = await buildAuthData(rpId, { credentialId: credId, coseKey: ecCose, signCount: 0 });
  const parsedReg = parseAuthenticatorData(regAuthData);
  check('parse registration authData', parsedReg.attestedCredentialData && bytesEqual(parsedReg.credentialId!, credId) && parsedReg.userVerified);
  check('registration COSE key extract', coseToJwk(parsedReg.cosePublicKey!).jwk.x === ecJwk.x);

  // Assertion: sign authData || sha256(clientDataJSON)
  const challenge = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
  check('clientData validation ok', validateClientData(clientData, { type: 'webauthn.get', expectedChallenge: challenge, expectedOrigin: origin }) === null);
  check('clientData rejects wrong origin', validateClientData(clientData, { type: 'webauthn.get', expectedChallenge: challenge, expectedOrigin: 'https://evil.example' }) !== null);
  check('clientData rejects wrong type', validateClientData(clientData, { type: 'webauthn.create', expectedChallenge: challenge, expectedOrigin: origin }) !== null);

  const assertAuthData = await buildAuthData(rpId, { signCount: 7 });
  const clientDataHash = await sha256(clientData);
  const message = new Uint8Array([...assertAuthData, ...clientDataHash]);
  const rawSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ecPair.privateKey, message));
  const derSig = rawToDerEcdsa(rawSig);

  check('ES256 assertion verifies', await verifyWebAuthnSignature(converted, assertAuthData, clientData, derSig));

  const tamperedAuthData = assertAuthData.slice();
  tamperedAuthData[36] ^= 0xff; // flip sign count byte
  check('ES256 rejects tampered authData', !(await verifyWebAuthnSignature(converted, tamperedAuthData, clientData, derSig)));

  const tamperedClientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin: 'https://evil.example' }));
  check('ES256 rejects tampered clientData', !(await verifyWebAuthnSignature(converted, assertAuthData, tamperedClientData, derSig)));

  const otherPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const wrongSig = rawToDerEcdsa(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, otherPair.privateKey, message)));
  check('ES256 rejects wrong key', !(await verifyWebAuthnSignature(converted, assertAuthData, clientData, wrongSig)));

  // rpIdHash mismatch detection
  const otherRpAuthData = await buildAuthData('other.example.com', { signCount: 1 });
  const expectedHash = await sha256(new TextEncoder().encode(rpId));
  check('rpIdHash mismatch detected', !bytesEqual(parseAuthenticatorData(otherRpAuthData).rpIdHash, expectedHash));

  // RS256 -------------------------------------------------------------------
  const rsaPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const rsaJwk = await crypto.subtle.exportKey('jwk', rsaPair.publicKey);
  const rsaCose = cborEncodeCose([[1, 3], [3, COSE_ALG_RS256], [-1, b64urlDecode(rsaJwk.n!)], [-2, b64urlDecode(rsaJwk.e!)]]);
  const rsaConverted = coseToJwk(cborDecode(rsaCose) as Map<unknown, unknown>);
  check('COSE→JWK RS256', rsaConverted.algorithm === COSE_ALG_RS256 && rsaConverted.jwk.n === rsaJwk.n);

  const rsaSig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', rsaPair.privateKey, message));
  check('RS256 assertion verifies', await verifyWebAuthnSignature(rsaConverted, assertAuthData, clientData, rsaSig));
  check('RS256 rejects tampered authData', !(await verifyWebAuthnSignature(rsaConverted, tamperedAuthData, clientData, rsaSig)));

  // Unsupported key type rejected
  let threw = false;
  try { coseToJwk(cborDecode(cborEncodeCose([[1, 1], [3, -8]])) as Map<unknown, unknown>); } catch { threw = true; }
  check('unsupported COSE key type rejected', threw);

  console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) FAILED.`);
  if (failures > 0) process.exit(1);
}

main();
