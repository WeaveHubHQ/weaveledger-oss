import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { verifyAndDecodeJWS, decodeJWSPayload } from '../utils/apple-jws';

/**
 * Attempt to verify and decode a signed transaction string.
 * Tries full JWS verification first (production Apple-signed transactions),
 * then falls back to unverified JWS decode (sandbox), then raw JSON parse
 * (StoreKit 2 jsonRepresentation which is unsigned JSON, not JWS).
 */
async function verifyOrDecodeTransaction(signedTxn: string): Promise<{ txnInfo: Record<string, unknown>; verified: boolean }> {
  // 1. Try full Apple JWS verification (production)
  try {
    const txnInfo = await verifyAndDecodeJWS(signedTxn);
    return { txnInfo, verified: true };
  } catch {
    // Fall through
  }

  // 2. Try unverified JWS decode (sandbox — valid JWS format but not Apple-signed)
  try {
    const txnInfo = decodeJWSPayload(signedTxn);
    console.warn('JWS verification failed, fell back to unverified JWS decode (sandbox?)');
    return { txnInfo, verified: false };
  } catch {
    // Fall through
  }

  // 3. Try raw JSON parse (StoreKit 2 jsonRepresentation — not JWS at all)
  try {
    const txnInfo = JSON.parse(signedTxn) as Record<string, unknown>;
    console.warn('Transaction is raw JSON (not JWS), accepted as unverified (sandbox/testing)');
    return { txnInfo, verified: false };
  } catch {
    throw new Error('Invalid signed transaction: not a valid JWS or JSON');
  }
}

// POST /api/app-subscription/verify
export async function verifyAppSubscription(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ signedTransactionInfo: string }>();

  if (!body.signedTransactionInfo) {
    return error('signedTransactionInfo is required');
  }

  let txnInfo: Record<string, unknown>;
  try {
    const inputPreview = body.signedTransactionInfo.substring(0, 200);
    console.log(`[verify] Input preview (${body.signedTransactionInfo.length} chars): ${inputPreview}`);
    const result = await verifyOrDecodeTransaction(body.signedTransactionInfo);
    txnInfo = result.txnInfo;
    console.log(`[verify] Decoded fields: ${Object.keys(txnInfo).join(', ')}`);
  } catch (e) {
    console.error('Failed to verify signed transaction:', e);
    console.error(`[verify] Input was ${body.signedTransactionInfo.length} chars, starts with: ${body.signedTransactionInfo.substring(0, 100)}`);
    return error('Invalid signed transaction');
  }

  // Handle both JWS field names (Server API) and StoreKit 2 jsonRepresentation field names
  const originalTransactionId = String(txnInfo.originalTransactionId || txnInfo.originalID || '');
  const transactionId = String(txnInfo.transactionId || txnInfo.id || '');
  const productId = String(txnInfo.productId || txnInfo.productID || '');
  const bundleId = String(txnInfo.bundleId || txnInfo.bundleID || txnInfo.appBundleID || '');
  const rawExpiry = txnInfo.expiresDate || txnInfo.expirationDate;
  const expiresDate = rawExpiry
    ? (typeof rawExpiry === 'number'
        ? new Date(rawExpiry).toISOString()
        : String(rawExpiry))
    : null;
  const environment = String(txnInfo.environment || 'Production');

  if (!originalTransactionId || !productId || !expiresDate) {
    return error('Transaction missing required fields (originalTransactionId, productId, expiresDate)');
  }

  // M-3: Validate bundle ID matches expected value (skip if not set or empty)
  if (env.APPLE_BUNDLE_ID && bundleId && bundleId !== env.APPLE_BUNDLE_ID) {
    return error('Bundle ID mismatch');
  }

  const id = generateId('appsub');

  // B2: Upsert into app_subscriptions — do NOT reassign user_id on conflict
  try {
    await env.DB.prepare(`
      INSERT INTO app_subscriptions (id, user_id, original_transaction_id, transaction_id, product_id, bundle_id, status, expires_at, environment, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'))
      ON CONFLICT(original_transaction_id) DO UPDATE SET
        transaction_id = excluded.transaction_id,
        product_id = excluded.product_id,
        bundle_id = excluded.bundle_id,
        status = 'active',
        expires_at = excluded.expires_at,
        environment = excluded.environment,
        updated_at = datetime('now')
    `).bind(id, userId, originalTransactionId, transactionId, productId, bundleId, expiresDate, environment).run();
  } catch (dbErr) {
    console.error('[verify] DB upsert failed:', dbErr, { originalTransactionId, productId, environment, expiresDate });
    return error('Failed to save subscription record', 500);
  }

  // B2: Verify the subscription belongs to the requesting user
  const existingSub = await env.DB.prepare(
    'SELECT user_id FROM app_subscriptions WHERE original_transaction_id = ?'
  ).bind(originalTransactionId).first<{ user_id: string }>();
  if (existingSub && existingSub.user_id !== userId) {
    return error('This subscription is linked to a different account', 403);
  }

  // Update user subscription tier
  await env.DB.prepare(`
    UPDATE users SET subscription_tier = 'pro', subscription_expires_at = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(expiresDate, userId).run();

  // Register with centralized licensing worker (fire-and-forget)
  if (env.LICENSING_URL) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (env.LICENSING_API_KEY) {
        headers['Authorization'] = `Bearer ${env.LICENSING_API_KEY}`;
      }
      fetch(`${env.LICENSING_URL}/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ signedTransactionInfo: body.signedTransactionInfo }),
      }).catch(() => {});
    } catch {}
  }

  return success({ subscription_tier: 'pro', expires_at: expiresDate });
}

// GET /api/app-subscription/status
export async function getAppSubscriptionStatus(request: Request, env: Env, userId: string): Promise<Response> {
  const sub = await env.DB.prepare(`
    SELECT product_id, status, expires_at, auto_renew_enabled
    FROM app_subscriptions
    WHERE user_id = ?
    ORDER BY expires_at DESC
    LIMIT 1
  `).bind(userId).first<{ product_id: string; status: string; expires_at: string; auto_renew_enabled: number }>();

  if (!sub) {
    // Check if user has grandfathered pro access
    const user = await env.DB.prepare(
      'SELECT subscription_tier, subscription_expires_at FROM users WHERE id = ?'
    ).bind(userId).first<{ subscription_tier: string; subscription_expires_at: string | null }>();

    if (user && user.subscription_tier === 'pro' && user.subscription_expires_at) {
      return success({
        subscription_tier: 'pro',
        expires_at: user.subscription_expires_at,
        auto_renew_enabled: false,
        product_id: null,
      });
    }

    return success({ subscription_tier: 'free' });
  }

  return success({
    subscription_tier: sub.status === 'active' || sub.status === 'grace_period' || sub.status === 'billing_retry' ? 'pro' : 'free',
    expires_at: sub.expires_at,
    auto_renew_enabled: !!sub.auto_renew_enabled,
    product_id: sub.product_id,
  });
}

// POST /api/app-subscription/restore
export async function restoreAppSubscription(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ signedTransactions: string[] }>();

  if (!body.signedTransactions || !Array.isArray(body.signedTransactions) || body.signedTransactions.length === 0) {
    return error('signedTransactions array is required');
  }

  let latestExpiry: string | null = null;
  let latestProductId: string | null = null;

  for (const signedTxn of body.signedTransactions) {
    let txnInfo: Record<string, unknown>;
    try {
      const result = await verifyOrDecodeTransaction(signedTxn);
      txnInfo = result.txnInfo;
    } catch {
      continue; // Skip malformed or unverifiable transactions
    }

    // Handle both JWS and StoreKit 2 jsonRepresentation field names
    const originalTransactionId = String(txnInfo.originalTransactionId || txnInfo.originalID || '');
    const transactionId = String(txnInfo.transactionId || txnInfo.id || '');
    const productId = String(txnInfo.productId || txnInfo.productID || '');
    const bundleId = String(txnInfo.bundleId || txnInfo.bundleID || txnInfo.appBundleID || '');
    const rawExpiry = txnInfo.expiresDate || txnInfo.expirationDate;
    const expiresDate = rawExpiry
      ? (typeof rawExpiry === 'number'
          ? new Date(rawExpiry).toISOString()
          : String(rawExpiry))
      : null;
    const environment = String(txnInfo.environment || 'Production');

    if (!originalTransactionId || !productId || !expiresDate) continue;

    // M-3: Validate bundle ID matches expected value (skip if not set or empty)
    if (env.APPLE_BUNDLE_ID && bundleId && bundleId !== env.APPLE_BUNDLE_ID) continue;

    const id = generateId('appsub');

    // B2: Upsert each transaction — do NOT reassign user_id on conflict
    await env.DB.prepare(`
      INSERT INTO app_subscriptions (id, user_id, original_transaction_id, transaction_id, product_id, bundle_id, status, expires_at, environment, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'))
      ON CONFLICT(original_transaction_id) DO UPDATE SET
        transaction_id = excluded.transaction_id,
        product_id = excluded.product_id,
        bundle_id = excluded.bundle_id,
        status = 'active',
        expires_at = excluded.expires_at,
        environment = excluded.environment,
        updated_at = datetime('now')
    `).bind(id, userId, originalTransactionId, transactionId, productId, bundleId, expiresDate, environment).run();

    // B2: Verify the subscription belongs to the requesting user
    const existingSub = await env.DB.prepare(
      'SELECT user_id FROM app_subscriptions WHERE original_transaction_id = ?'
    ).bind(originalTransactionId).first<{ user_id: string }>();
    if (existingSub && existingSub.user_id !== userId) {
      continue; // Skip subscriptions that belong to a different user
    }

    // Track the latest expiry
    if (!latestExpiry || expiresDate > latestExpiry) {
      latestExpiry = expiresDate;
      latestProductId = productId;
    }
  }

  if (!latestExpiry) {
    return error('No valid transactions found in restore data');
  }

  // Update user subscription tier with the latest expiry
  await env.DB.prepare(`
    UPDATE users SET subscription_tier = 'pro', subscription_expires_at = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(latestExpiry, userId).run();

  return success({ subscription_tier: 'pro', expires_at: latestExpiry, product_id: latestProductId });
}

// POST /api/webhooks/apple-notifications (public endpoint, no JWT auth)
export async function handleAppleNotificationWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ signedPayload: string }>();

    if (!body.signedPayload) {
      return new Response('OK', { status: 200 });
    }

    let decoded: Record<string, unknown>;
    try {
      decoded = await verifyAndDecodeJWS(body.signedPayload);
    } catch (e) {
      console.error('Failed to verify Apple notification payload:', e);
      return new Response('OK', { status: 200 });
    }

    const notificationType = String(decoded.notificationType || '');
    const subtype = String(decoded.subtype || '');

    // Extract transaction info from the notification data
    const data = decoded.data as Record<string, unknown> | undefined;
    if (!data) {
      return new Response('OK', { status: 200 });
    }

    const signedTransactionInfo = data.signedTransactionInfo as string | undefined;
    if (!signedTransactionInfo) {
      return new Response('OK', { status: 200 });
    }

    let txnInfo: Record<string, unknown>;
    try {
      txnInfo = await verifyAndDecodeJWS(signedTransactionInfo);
    } catch {
      return new Response('OK', { status: 200 });
    }

    const originalTransactionId = String(txnInfo.originalTransactionId || '');
    const transactionId = String(txnInfo.transactionId || '');
    const productId = String(txnInfo.productId || '');
    const bundleId = String(txnInfo.bundleId || '');

    // M-3: Validate bundle ID matches expected value
    if (env.APPLE_BUNDLE_ID && bundleId && bundleId !== env.APPLE_BUNDLE_ID) {
      console.warn(`Apple notification bundleId mismatch: got ${bundleId}, expected ${env.APPLE_BUNDLE_ID}`);
      return new Response('OK', { status: 200 });
    }
    const expiresDate = txnInfo.expiresDate
      ? new Date(txnInfo.expiresDate as number).toISOString()
      : null;
    const environment = String(txnInfo.environment || 'Production');
    const revocationDate = txnInfo.revocationDate
      ? new Date(txnInfo.revocationDate as number).toISOString()
      : null;
    const revocationReason = txnInfo.revocationReason as number | undefined;

    if (!originalTransactionId) {
      return new Response('OK', { status: 200 });
    }

    // Look up existing subscription by original_transaction_id
    const existingSub = await env.DB.prepare(
      'SELECT id, user_id FROM app_subscriptions WHERE original_transaction_id = ?'
    ).bind(originalTransactionId).first<{ id: string; user_id: string }>();

    if (!existingSub) {
      // We received a notification for a subscription we don't track yet -- nothing to do
      console.warn(`Apple notification for unknown original_transaction_id: ${originalTransactionId}`);
      return new Response('OK', { status: 200 });
    }

    const userId = existingSub.user_id;

    // Handle notification types
    switch (notificationType) {
      case 'SUBSCRIBED':
      case 'DID_RENEW': {
        await env.DB.prepare(`
          UPDATE app_subscriptions SET
            status = 'active', transaction_id = ?, product_id = ?, bundle_id = ?,
            expires_at = COALESCE(?, expires_at), renewed_at = datetime('now'),
            auto_renew_enabled = 1, canceled_at = NULL,
            last_notification_type = ?, last_notification_subtype = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).bind(transactionId, productId, bundleId, expiresDate, notificationType, subtype, existingSub.id).run();

        await env.DB.prepare(`
          UPDATE users SET subscription_tier = 'pro', subscription_expires_at = COALESCE(?, subscription_expires_at), updated_at = datetime('now') WHERE id = ?
        `).bind(expiresDate, userId).run();
        break;
      }

      case 'DID_CHANGE_RENEWAL_STATUS': {
        if (subtype === 'AUTO_RENEW_DISABLED') {
          await env.DB.prepare(`
            UPDATE app_subscriptions SET
              auto_renew_enabled = 0, canceled_at = datetime('now'),
              last_notification_type = ?, last_notification_subtype = ?,
              updated_at = datetime('now')
            WHERE id = ?
          `).bind(notificationType, subtype, existingSub.id).run();
        } else if (subtype === 'AUTO_RENEW_ENABLED') {
          await env.DB.prepare(`
            UPDATE app_subscriptions SET
              auto_renew_enabled = 1, canceled_at = NULL,
              last_notification_type = ?, last_notification_subtype = ?,
              updated_at = datetime('now')
            WHERE id = ?
          `).bind(notificationType, subtype, existingSub.id).run();
        }
        break;
      }

      case 'EXPIRED':
      case 'GRACE_PERIOD_EXPIRED': {
        await env.DB.prepare(`
          UPDATE app_subscriptions SET
            status = 'expired',
            last_notification_type = ?, last_notification_subtype = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).bind(notificationType, subtype, existingSub.id).run();

        await env.DB.prepare(`
          UPDATE users SET subscription_tier = 'free', updated_at = datetime('now') WHERE id = ?
        `).bind(userId).run();
        break;
      }

      case 'DID_FAIL_TO_RENEW': {
        const newStatus = subtype === 'GRACE_PERIOD' ? 'grace_period' : 'billing_retry';
        await env.DB.prepare(`
          UPDATE app_subscriptions SET
            status = ?,
            last_notification_type = ?, last_notification_subtype = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).bind(newStatus, notificationType, subtype, existingSub.id).run();
        break;
      }

      case 'REVOKE':
      case 'REFUND': {
        await env.DB.prepare(`
          UPDATE app_subscriptions SET
            status = 'revoked',
            revocation_date = ?, revocation_reason = ?,
            last_notification_type = ?, last_notification_subtype = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).bind(revocationDate, revocationReason ?? null, notificationType, subtype, existingSub.id).run();

        await env.DB.prepare(`
          UPDATE users SET subscription_tier = 'free', updated_at = datetime('now') WHERE id = ?
        `).bind(userId).run();
        break;
      }

      default: {
        // Log unknown notification types but still acknowledge
        console.warn(`Unhandled Apple notification type: ${notificationType} / ${subtype}`);
        await env.DB.prepare(`
          UPDATE app_subscriptions SET
            last_notification_type = ?, last_notification_subtype = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).bind(notificationType, subtype, existingSub.id).run();
        break;
      }
    }

    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Apple notification webhook error:', e);
    // Always return 200 to prevent Apple retries on processing errors
    return new Response('OK', { status: 200 });
  }
}
