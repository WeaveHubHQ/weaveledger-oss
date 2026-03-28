import { Env } from '../../types';

interface GooglePlayCredentials {
  client_email: string;
  private_key: string;
  package_name: string;
}

export async function getGoogleAccessToken(creds: GooglePlayCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${encode(header)}.${encode(payload)}`;

  // Import RSA private key (handle escaped \n from JSON input)
  const pemBody = creds.private_key
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(signingInput)
  );

  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${encodedSig}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    throw new Error(`Google OAuth error: ${err.slice(0, 300)}`);
  }

  const tokenData = await tokenResponse.json<{ access_token: string }>();
  return tokenData.access_token;
}

// Google Play doesn't have a bulk "list subscribers" API.
// Income is tracked via RTDN webhooks for subscription events.
// This sync validates the service account credentials and reports success.
export async function syncGooglePlay(
  env: Env, userId: string, integrationId: string, credentials: GooglePlayCredentials, _lastSyncAt: string | null
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];

  try {
    // Validate credentials by fetching an access token
    await getGoogleAccessToken(credentials);
    // Google Play subscription data comes from RTDN webhooks, not bulk sync
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Unknown Google Play error');
  }

  return { synced: 0, errors };
}
