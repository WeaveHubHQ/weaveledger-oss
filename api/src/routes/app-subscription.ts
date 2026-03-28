import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { decodeJWSPayload } from '../utils/apple-jws';

// POST /api/app-subscription/verify
export async function verifyAppSubscription(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ signedTransactionInfo: string }>();

  if (!body.signedTransactionInfo) {
    return error('signedTransactionInfo is required');
  }

  let txnInfo: Record<string, unknown>;
  try {
    txnInfo = decodeJWSPayload(body.signedTransactionInfo);
  } catch (e) {
    console.error('Failed to decode signed transaction:', e);
    return error('Invalid signed transaction');
  }

  const originalTransactionId = String(txnInfo.originalTransactionId || '');
  const transactionId = String(txnInfo.transactionId || '');
  const productId = String(txnInfo.productId || '');
  const bundleId = String(txnInfo.bundleId || '');
  const expiresDate = txnInfo.expiresDate
    ? new Date(txnInfo.expiresDate as number).toISOString()
    : null;
  const environment = String(txnInfo.environment || 'Production');

  if (!originalTransactionId || !productId || !expiresDate) {
    return error('Transaction missing required fields (originalTransactionId, productId, expiresDate)');
  }

  const id = generateId('appsub');

  // Upsert into app_subscriptions
  await env.DB.prepare(`
    INSERT INTO app_subscriptions (id, user_id, original_transaction_id, transaction_id, product_id, bundle_id, status, expires_at, environment, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'))
    ON CONFLICT(original_transaction_id) DO UPDATE SET
      user_id = excluded.user_id,
      transaction_id = excluded.transaction_id,
      product_id = excluded.product_id,
      bundle_id = excluded.bundle_id,
      status = 'active',
      expires_at = excluded.expires_at,
      environment = excluded.environment,
      updated_at = datetime('now')
  `).bind(id, userId, originalTransactionId, transactionId, productId, bundleId, expiresDate, environment).run();

  // Update user subscription tier
  await env.DB.prepare(`
    UPDATE users SET subscription_tier = 'pro', subscription_expires_at = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(expiresDate, userId).run();

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
      txnInfo = decodeJWSPayload(signedTxn);
    } catch {
      continue; // Skip malformed transactions
    }

    const originalTransactionId = String(txnInfo.originalTransactionId || '');
    const transactionId = String(txnInfo.transactionId || '');
    const productId = String(txnInfo.productId || '');
    const bundleId = String(txnInfo.bundleId || '');
    const expiresDate = txnInfo.expiresDate
      ? new Date(txnInfo.expiresDate as number).toISOString()
      : null;
    const environment = String(txnInfo.environment || 'Production');

    if (!originalTransactionId || !productId || !expiresDate) continue;

    const id = generateId('appsub');

    // Upsert each transaction
    await env.DB.prepare(`
      INSERT INTO app_subscriptions (id, user_id, original_transaction_id, transaction_id, product_id, bundle_id, status, expires_at, environment, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'))
      ON CONFLICT(original_transaction_id) DO UPDATE SET
        user_id = excluded.user_id,
        transaction_id = excluded.transaction_id,
        product_id = excluded.product_id,
        bundle_id = excluded.bundle_id,
        status = 'active',
        expires_at = excluded.expires_at,
        environment = excluded.environment,
        updated_at = datetime('now')
    `).bind(id, userId, originalTransactionId, transactionId, productId, bundleId, expiresDate, environment).run();

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
      decoded = decodeJWSPayload(body.signedPayload);
    } catch (e) {
      console.error('Failed to decode Apple notification payload:', e);
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
      txnInfo = decodeJWSPayload(signedTransactionInfo);
    } catch {
      return new Response('OK', { status: 200 });
    }

    const originalTransactionId = String(txnInfo.originalTransactionId || '');
    const transactionId = String(txnInfo.transactionId || '');
    const productId = String(txnInfo.productId || '');
    const bundleId = String(txnInfo.bundleId || '');
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
