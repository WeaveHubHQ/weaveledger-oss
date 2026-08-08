/**
 * WeaveHub AI account endpoints — proxy usage and credit purchases to the
 * ai.weavehub.app gateway using the caller's stored (encrypted) wh_ai_ key,
 * so the key never reaches the browser.
 */
import { Env } from '../types';
import { success, error } from '../utils/response';
import { decryptValue, encryptValue } from '../utils/crypto';

const WEAVEHUB_AI_URL = 'https://ai.weavehub.app';

async function resolveWeavehubKey(env: Env, userId: string): Promise<string | null> {
  const user = await env.DB.prepare(
    'SELECT weavehub_ai_key FROM users WHERE id = ?'
  ).bind(userId).first<{ weavehub_ai_key: string | null }>();
  if (user?.weavehub_ai_key) {
    try {
      return await decryptValue(user.weavehub_ai_key, env.JWT_SECRET, userId);
    } catch { /* fall through */ }
  }
  return env.CLAUDE_API_KEY?.startsWith('wh_ai_') ? env.CLAUDE_API_KEY : null;
}

/** Create a WeaveHub AI key for this user from inside the portal and store it
    encrypted immediately — the plaintext never reaches the browser at all. */
export async function createAiKey(request: Request, env: Env, userId: string): Promise<Response> {
  const user = await env.DB.prepare(
    'SELECT email, weavehub_ai_key FROM users WHERE id = ?'
  ).bind(userId).first<{ email: string; weavehub_ai_key: string | null }>();
  if (!user) return error('User not found', 404);
  if (user.weavehub_ai_key) return error('A WeaveHub AI key is already saved for this account.', 409);

  const host = new URL(request.url).hostname;
  const resp = await fetch(`${WEAVEHUB_AI_URL}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, label: `${user.email} @ ${host}` }),
  });
  const data = await resp.json<{ key?: string; trial_scans?: number; error?: { message?: string } }>();
  if (!resp.ok || !data.key) return error(data.error?.message || 'Could not create a WeaveHub AI key', resp.status === 409 ? 409 : 502);

  const encrypted = await encryptValue(data.key, env.JWT_SECRET, userId);
  await env.DB.prepare(
    "UPDATE users SET weavehub_ai_key = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(encrypted, userId).run();

  return success({ trial_scans: data.trial_scans || 0 }, 'WeaveHub AI key created and saved');
}

export async function getAiUsage(request: Request, env: Env, userId: string): Promise<Response> {
  const key = await resolveWeavehubKey(env, userId);
  if (!key) return error('No WeaveHub AI key configured. Save one under Settings → AI Provider.', 404);
  const resp = await fetch(`${WEAVEHUB_AI_URL}/v1/usage`, { headers: { 'x-api-key': key } });
  const data = await resp.json<{ usage?: unknown; error?: { message?: string } }>();
  if (!resp.ok) return error(data.error?.message || 'Could not load WeaveHub AI usage', 502);
  return success(data.usage);
}

export async function createAiCheckout(request: Request, env: Env, userId: string): Promise<Response> {
  const key = await resolveWeavehubKey(env, userId);
  if (!key) return error('No WeaveHub AI key configured. Save one under Settings → AI Provider.', 404);

  const body = await request.json<{ pack?: string }>().catch(() => ({} as { pack?: string }));
  // Send the buyer back to this instance's settings page after checkout.
  const origin = new URL(request.url).origin;
  const resp = await fetch(`${WEAVEHUB_AI_URL}/v1/checkout`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pack: body.pack || 'starter',
      success_url: `${origin}/#settings?ai_topup=success`,
      cancel_url: `${origin}/#settings?ai_topup=cancelled`,
    }),
  });
  const data = await resp.json<{ url?: string; pack?: string; scans?: number; error?: { message?: string } }>();
  if (!resp.ok || !data.url) return error(data.error?.message || 'Could not start checkout', 502);
  return success({ url: data.url, pack: data.pack, scans: data.scans });
}
