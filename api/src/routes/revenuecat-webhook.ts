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

  // 4. Process. We resolve the WeaveLedger user from app_user_id (set via
  //    Purchases.shared.logIn from the iOS app). RC sometimes sends
  //    original_app_user_id when an alias was generated client-side before
  //    logIn — accept either.
  const candidates = [event.app_user_id, event.original_app_user_id, ...(event.aliases || [])]
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  const userId = candidates.find((id) => id.startsWith('usr_')) || null;

  let processStatus: 'applied' | 'skipped_no_user' | 'skipped_unhandled' = 'skipped_unhandled';

  try {
    if (!userId) {
      processStatus = 'skipped_no_user';
      console.warn(`[RC] No usr_ in event ${event.id} candidates: ${candidates.join(',')}`);
    } else if (GRANTING_EVENTS.has(event.type)) {
      const expiresAt = event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : null;
      await env.DB.prepare(
        `UPDATE users SET subscription_tier = 'pro',
                          subscription_expires_at = COALESCE(?, subscription_expires_at),
                          updated_at = datetime('now')
         WHERE id = ?`
      ).bind(expiresAt, userId).run();
      processStatus = 'applied';
      console.log(`[RC] Granted pro to ${userId} via ${event.type} expires=${expiresAt}`);
    } else if (REVOKING_EVENTS.has(event.type)) {
      // Honor any future-dated expiry the event still carries (e.g., paused
      // subscription with grace), otherwise downgrade immediately.
      const expiresAt = event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : new Date().toISOString();
      const stillActive = event.expiration_at_ms && event.expiration_at_ms > Date.now();
      await env.DB.prepare(
        `UPDATE users SET subscription_tier = ?,
                          subscription_expires_at = ?,
                          updated_at = datetime('now')
         WHERE id = ?`
      ).bind(stillActive ? 'pro' : 'free', expiresAt, userId).run();
      processStatus = 'applied';
      console.log(`[RC] Revoked/expired ${userId} via ${event.type} (still_active=${!!stillActive})`);
    } else if (SOFT_EVENTS.has(event.type)) {
      // Cancellation / billing issue: user keeps entitlement until expiry.
      // Just refresh the expiry so the client sees the most recent value.
      if (event.expiration_at_ms) {
        const expiresAt = new Date(event.expiration_at_ms).toISOString();
        await env.DB.prepare(
          `UPDATE users SET subscription_expires_at = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).bind(expiresAt, userId).run();
      }
      processStatus = 'applied';
      console.log(`[RC] Soft event ${event.type} for ${userId} — no tier change`);
    } else if (event.type === 'TRANSFER') {
      // Subscription moved between accounts. transferred_from = old user(s),
      // transferred_to (or app_user_id) = new user. We downgrade the old and
      // grant the new.
      const oldUsers = (event.transferred_from || []).filter((u) => u.startsWith('usr_'));
      const newUser = userId; // already resolved from app_user_id
      const expiresAt = event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : null;
      for (const oldId of oldUsers) {
        await env.DB.prepare(
          `UPDATE users SET subscription_tier = 'free', updated_at = datetime('now') WHERE id = ?`
        ).bind(oldId).run();
      }
      if (newUser) {
        await env.DB.prepare(
          `UPDATE users SET subscription_tier = 'pro',
                            subscription_expires_at = COALESCE(?, subscription_expires_at),
                            updated_at = datetime('now')
           WHERE id = ?`
        ).bind(expiresAt, newUser).run();
      }
      processStatus = 'applied';
      console.log(`[RC] Transfer: from=${oldUsers.join(',')} to=${newUser}`);
    } else {
      // Unknown / unhandled event — recorded but no state change. INVOICE_ISSUANCE,
      // VIRTUAL_CURRENCY_TRANSACTION, SUBSCRIBER_ALIAS, etc.
      console.log(`[RC] Recorded ${event.type} (no handler) for ${userId}`);
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
