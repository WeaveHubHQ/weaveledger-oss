import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';

// LED-27: Receive RevenueCat webhook events and propagate entitlement state
// to D1. RevenueCat is the authoritative source of subscription truth from
// this point forward; the legacy /api/app-subscription/verify route stays
// in place during the iOS migration but should be considered redundant once
// the RC SDK is shipping in production for all clients.
//
// Auth: RC sends the configured `Authorization` header on every webhook
// delivery. We compare it byte-for-byte against the worker secret. No
// signature scheme (RC's webhook auth is shared-secret bearer).
//
// Idempotency: every event has a stable id; we upsert into webhook_events
// with a UNIQUE(source, event_id) index. Duplicate deliveries hit the
// conflict path and we return 200 without re-processing — RC retries
// aggressively on 5xx and we do NOT want to double-grant entitlements.

// The one entitlement this backend acts on. Events for anything else are
// recorded and skipped.
const PRO_ENTITLEMENT = 'pro';
// Fallback when an event carries no entitlement list at all: our own Pro SKUs.
const PRO_PRODUCT_PREFIX = 'app.weavehub.weaveledger.pro.';
// Tolerated clock skew for event timestamps. A timestamp further ahead than
// this is clamped, so one bad event can't freeze a user's state forever.
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

const finiteMs = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

interface RevenueCatEvent {
  id: string;
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  event_timestamp_ms?: number;
  environment?: string;
  transferred_from?: string[];
  transferred_to?: string[];
  store?: string;
}

interface RevenueCatWebhookPayload {
  api_version?: string;
  event?: RevenueCatEvent;
}

// Event types that imply the user currently has the entitlement.
const GRANTING_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
  'PRODUCT_CHANGE',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'NON_RENEWING_PURCHASE',
  'REFUND_REVERSED',
]);

// Event types that imply the entitlement should be considered ended.
const REVOKING_EVENTS = new Set([
  'EXPIRATION',
  'SUBSCRIPTION_PAUSED',
]);

// Event types where the user may still have entitlement (cancellation just
// disables auto-renew until period end). Update tracking but don't downgrade.
const SOFT_EVENTS = new Set([
  'CANCELLATION',
  'BILLING_ISSUE',
]);

export async function handleRevenueCatWebhook(request: Request, env: Env): Promise<Response> {
  // 1. Auth — shared-secret bearer, compared byte-for-byte.
  const expected = env.RC_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[RC] RC_WEBHOOK_SECRET not configured — rejecting');
    return error('Webhook not configured', 503);
  }
  const auth = request.headers.get('Authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!timingSafeEqual(provided, expected)) {
    console.warn('[RC] Invalid webhook auth');
    return error('Unauthorized', 401);
  }

  // 2. Parse + validate shape.
  let payload: RevenueCatWebhookPayload;
  try {
    payload = await request.json<RevenueCatWebhookPayload>();
  } catch (e) {
    return error('Invalid JSON body', 400);
  }
  const event = payload.event;
  if (!event || !event.id || !event.type) {
    return error('Missing event.id or event.type', 400);
  }

  // 3. Idempotent insert. UNIQUE(source, event_id) makes the second
  //    delivery hit the conflict path; we return 200 without re-processing.
  const rowId = generateId('whev');
  const rawPayload = JSON.stringify(payload);
  let isDuplicate = false;
  try {
    await env.DB.prepare(
      `INSERT INTO webhook_events (id, source, event_id, event_type, payload)
       VALUES (?, 'revenuecat', ?, ?, ?)`
    ).bind(rowId, event.id, event.type, rawPayload).run();
  } catch (e: any) {
    if (String(e?.message || e).includes('UNIQUE')) {
      isDuplicate = true;
    } else {
      console.error('[RC] Failed to insert webhook_events:', e);
      return error('Internal error', 500);
    }
  }

  if (isDuplicate) {
    console.log(`[RC] Duplicate event ${event.id} (${event.type}) — already processed`);
    return success({ event_id: event.id, status: 'duplicate' });
  }

  // 4. Process.
  //
  // Every state change is guarded by `rc_last_event_ms`: an event only
  // applies if it is at least as new as the last one applied to that user,
  // so a late redelivery of an old EXPIRATION can't undo a RENEWAL (and
  // vice versa).
  const eventMs = Math.min(finiteMs(event.event_timestamp_ms) ?? Date.now(), Date.now() + MAX_FUTURE_SKEW_MS);
  type Status = 'applied' | 'skipped_no_user' | 'skipped_unhandled' | 'skipped_sandbox' | 'skipped_entitlement' | 'skipped_stale' | 'skipped_superseded';
  let processStatus: Status = 'skipped_unhandled';

  // tier: explicit value, or null to leave it alone. expiresAt: null keeps the stored value.
  const stateStatement = (id: string, tier: 'pro' | 'free' | null, expiresAt: string | null) =>
    env.DB.prepare(
      `UPDATE users SET subscription_tier = COALESCE(?, subscription_tier),
                        subscription_expires_at = COALESCE(?, subscription_expires_at),
                        rc_last_event_ms = ?,
                        updated_at = datetime('now')
       WHERE id = ? AND COALESCE(rc_last_event_ms, 0) <= ?`
    ).bind(tier, expiresAt, eventMs, id, eventMs);
  const applyState = async (id: string, tier: 'pro' | 'free' | null, expiresAt: string | null): Promise<boolean> =>
    ((await stateStatement(id, tier, expiresAt).run()).meta?.changes ?? 0) > 0;
  const userExists = async (id: string): Promise<boolean> =>
    !!(await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first());

  try {
    // Sandbox (Xcode / TestFlight / App Review) purchases cost nothing, so they
    // never change state here — except for accounts named in
    // RC_SANDBOX_USER_IDS (comma-separated usr_ ids), e.g. the App Review demo
    // account, whose sandbox purchase has to unlock the paid API routes.
    const sandboxAllowed = new Set((env.RC_SANDBOX_USER_IDS || '').split(',').map((v) => v.trim()).filter(Boolean));
    const eventUserIds = [event.app_user_id, event.original_app_user_id, ...(event.aliases || []),
      ...(event.transferred_from || []), ...(event.transferred_to || [])].filter((v): v is string => typeof v === 'string');
    if (event.environment === 'SANDBOX' && !eventUserIds.some((id) => sandboxAllowed.has(id))) {
      processStatus = 'skipped_sandbox';
    } else if (event.type === 'TRANSFER') {
      // The subscription moved between accounts. TRANSFER carries no
      // app_user_id, expiry, or entitlements — only the two id lists. Move
      // the old account's expiry to the new one; the next RENEWAL corrects it.
      const fromIds = (event.transferred_from || []).filter((u) => u.startsWith('usr_'));
      const toIds = (event.transferred_to || []).filter((u) => u.startsWith('usr_'));
      // Read before writing, and regardless of tier, so a redelivery after a
      // partial failure still finds the expiry to carry.
      let carriedExpiry: string | null = null;
      for (const id of fromIds) {
        const row = await env.DB.prepare('SELECT subscription_expires_at FROM users WHERE id = ?')
          .bind(id).first<{ subscription_expires_at: string | null }>();
        const t = row?.subscription_expires_at ? new Date(row.subscription_expires_at).getTime() : NaN;
        if (Number.isFinite(t) && (!carriedExpiry || t > new Date(carriedExpiry).getTime())) {
          carriedExpiry = new Date(t).toISOString();
        }
      }
      // One batch = one transaction: the old account is never freed without
      // the new one being granted.
      const stmts = [
        ...fromIds.map((id) => stateStatement(id, 'free', null)),
        ...toIds.map((id) => stateStatement(id, 'pro', carriedExpiry)),
      ];
      const results = stmts.length ? await env.DB.batch(stmts) : [];
      const touched = results.filter((r) => (r.meta?.changes ?? 0) > 0).length;
      processStatus = fromIds.length + toIds.length === 0 ? 'skipped_no_user' : touched > 0 ? 'applied' : 'skipped_stale';
      console.log(`[RC] Transfer from=${fromIds.join(',')} to=${toIds.join(',')} expiry=${carriedExpiry} status=${processStatus}`);
    } else {
      // The WeaveLedger user is the usr_ id set via Purchases.logIn; RC may
      // carry it as app_user_id, original_app_user_id, or an alias.
      const candidates = [event.app_user_id, event.original_app_user_id, ...(event.aliases || [])]
        .filter((s): s is string => typeof s === 'string' && s.length > 0);
      const userId = candidates.find((id) => id.startsWith('usr_')) || null;
      // An explicit entitlement list decides. If the event carries none at
      // all, fall back to the product id rather than dropping a real renewal.
      const forPro = Array.isArray(event.entitlement_ids)
        ? event.entitlement_ids.includes(PRO_ENTITLEMENT)
        : (event.product_id || '').startsWith(PRO_PRODUCT_PREFIX);
      const handled = GRANTING_EVENTS.has(event.type) || REVOKING_EVENTS.has(event.type) || SOFT_EVENTS.has(event.type);

      if (!handled) {
        console.log(`[RC] Recorded ${event.type} (no handler)`);
      } else if (!userId || !(await userExists(userId))) {
        processStatus = 'skipped_no_user';
        console.warn(`[RC] No known usr_ in event ${event.id}`);
      } else if (!forPro) {
        processStatus = 'skipped_entitlement';
        console.log(`[RC] ${event.type} for ${userId} does not carry the ${PRO_ENTITLEMENT} entitlement — skipped`);
      } else {
        const expMs = finiteMs(event.expiration_at_ms);
        const expiresAt = expMs ? new Date(expMs).toISOString() : null;
        let tier: 'pro' | 'free' | null;
        let expiry = expiresAt;
        if (GRANTING_EVENTS.has(event.type)) {
          // A grant whose period has already ended (late delivery) is not a grant.
          tier = expMs !== null && expMs <= Date.now() ? 'free' : 'pro';
        } else if (REVOKING_EVENTS.has(event.type)) {
          tier = expMs !== null && expMs > Date.now() ? 'pro' : 'free';
          expiry = expiresAt ?? new Date().toISOString();
        } else {
          // Cancellation / billing issue: entitlement runs to period end, so only
          // refresh the expiry — unless that period is already over (a refund).
          tier = expMs !== null && expMs <= Date.now() ? 'free' : null;
        }
        // An event that would end Pro, but is about a different product than
        // the one this user is on, while that one still has time left: an
        // older subscription lapsing must not take the newer one with it.
        const current = tier === 'free'
          ? await env.DB.prepare('SELECT rc_product_id, subscription_expires_at FROM users WHERE id = ?')
              .bind(userId).first<{ rc_product_id: string | null; subscription_expires_at: string | null }>()
          : null;
        const superseded = !!current?.rc_product_id && !!event.product_id && current.rc_product_id !== event.product_id
          && !!current.subscription_expires_at && new Date(current.subscription_expires_at).getTime() > Date.now();
        if (superseded) {
          processStatus = 'skipped_superseded';
        } else {
          processStatus = (await applyState(userId, tier, expiry)) ? 'applied' : 'skipped_stale';
          if (processStatus === 'applied' && tier === 'pro' && event.product_id) {
            await env.DB.prepare('UPDATE users SET rc_product_id = ? WHERE id = ?').bind(event.product_id, userId).run();
          }
        }
        console.log(`[RC] ${event.type} for ${userId}: tier=${tier ?? 'unchanged'} expires=${expiry} status=${processStatus}`);
      }
    }
  } catch (e: any) {
    // Applying failed (e.g. a transient D1 error). Drop the dedupe row and
    // return 5xx so RevenueCat redelivers; acknowledging here would lose the
    // entitlement change for good.
    console.error(`[RC] Failed to apply event ${event.id}:`, e);
    await env.DB.prepare('DELETE FROM webhook_events WHERE id = ?').bind(rowId).run().catch(() => {});
    return error('Failed to apply event', 500);
  }

  await env.DB.prepare(
    `UPDATE webhook_events SET processed_at = datetime('now'),
                                process_status = ?
     WHERE id = ?`
  ).bind(processStatus, rowId).run();

  return success({ event_id: event.id, status: processStatus });
}

// Constant-time string comparison to avoid leaking the secret via timing.
// `crypto.subtle.timingSafeEqual` isn't in the Workers runtime; we roll our
// own by always iterating both strings to fixed length and OR-ing differences.
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
