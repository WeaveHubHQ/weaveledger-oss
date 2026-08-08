/**
 * WeaveHub AI account endpoints — proxy usage and credit purchases to the
 * ai.weavehub.app gateway using the caller's stored (encrypted) wh_ai_ key,
 * so the key never reaches the browser.
 */
import { Env } from '../types';
import { success, error } from '../utils/response';
import { decryptValue } from '../utils/crypto';

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
