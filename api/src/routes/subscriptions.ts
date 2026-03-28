import { Env } from '../types';
import { error, success } from '../utils/response';
import { decryptValue } from '../utils/crypto';
import { computeForecast, computeSubscriptionSummary } from '../services/forecasting';

type Provider = 'stripe' | 'google_play' | 'apple_app_store';

export async function listSubscriptions(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const status = url.searchParams.get('status') || 'active';
  const page = Math.max(parseInt(url.searchParams.get('page') || '1') || 1, 1);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 100);
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM subscriptions WHERE user_id = ?';
  let countQuery = 'SELECT COUNT(*) as total FROM subscriptions WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (status !== 'all') {
    if (status === 'active') {
      query += " AND status IN ('active', 'trialing')";
      countQuery += " AND status IN ('active', 'trialing')";
    } else {
      query += ' AND status = ?';
      countQuery += ' AND status = ?';
      params.push(status);
    }
  }

  if (source) {
    query += ' AND source = ?';
    countQuery += ' AND source = ?';
    params.push(source);
  }

  const total = await env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();

  query += ' ORDER BY current_period_end ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const results = await env.DB.prepare(query).bind(...params).all();

  return success({
    subscriptions: results.results,
    pagination: {
      page, limit,
      total: total?.total || 0,
      pages: Math.ceil((total?.total || 0) / limit),
    },
  });
}

export async function getSubscriptionSummary(request: Request, env: Env, userId: string): Promise<Response> {
  const summary = await computeSubscriptionSummary(env, userId);
  return success(summary);
}

export async function getSubscriptionForecast(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const months = Math.min(Math.max(parseInt(url.searchParams.get('months') || '12') || 12, 1), 24);
  const forecast = await computeForecast(env, userId, months);
  return success(forecast);
}

export async function syncSubscriptions(request: Request, env: Env, userId: string, integrationId: string): Promise<Response> {
  const integration = await env.DB.prepare(
    'SELECT id, provider, credentials FROM integrations WHERE id = ? AND user_id = ?'
  ).bind(integrationId, userId).first<{ id: string; provider: Provider; credentials: string }>();

  if (!integration) return error('Integration not found', 404);

  const decrypted = await decryptValue(integration.credentials, env.JWT_SECRET, userId);
  const creds: Record<string, string> = JSON.parse(decrypted);

  try {
    switch (integration.provider) {
      case 'stripe': {
        const { syncStripeSubscriptions } = await import('../services/integrations/stripe-subscriptions');
        const result = await syncStripeSubscriptions(env, userId, integration.id, creds.api_key);
        return success(result, `Synced ${result.synced} subscriptions, updated ${result.updated}`);
      }
      case 'google_play': {
        const { backfillGooglePlaySubscriptions } = await import('../services/integrations/google-play-subscriptions');
        const result = await backfillGooglePlaySubscriptions(env, userId, integration.id, {
          client_email: creds.client_email, private_key: creds.private_key, package_name: creds.package_name,
        });
        return success(result, `Backfilled ${result.synced} subscriptions from order history`);
      }
      case 'apple_app_store': {
        const { syncAppleSubscriptions } = await import('../services/integrations/apple-subscriptions');
        const result = await syncAppleSubscriptions(env, userId, integration.id, {
          issuer_id: creds.issuer_id, key_id: creds.key_id, private_key: creds.private_key, vendor_number: creds.vendor_number,
          server_key_id: creds.server_key_id, server_private_key: creds.server_private_key,
        });
        return success(result, `Synced ${result.synced} subscriptions, updated ${result.updated}`);
      }
      default:
        return error(`Subscription sync not supported for ${integration.provider}.`);
    }
  } catch (e) {
    console.error(`Subscription sync failed for ${integrationId}:`, e);
    return error('Subscription sync failed. Please check your integration credentials.');
  }
}

// Manually add a Google Play subscription by purchase token
export async function addGooglePlaySubscription(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ integration_id: string; purchase_token: string; subscription_id?: string; amount?: number }>();

  if (!body.integration_id || !body.purchase_token) {
    return error('integration_id and purchase_token are required');
  }

  const integration = await env.DB.prepare(
    "SELECT id, provider, credentials FROM integrations WHERE id = ? AND user_id = ? AND provider = 'google_play'"
  ).bind(body.integration_id, userId).first<{ id: string; provider: string; credentials: string }>();

  if (!integration) return error('Google Play integration not found', 404);

  const decrypted = await decryptValue(integration.credentials, env.JWT_SECRET, userId);
  const creds: Record<string, string> = JSON.parse(decrypted);

  try {
    const { handleGooglePlayNotification } = await import('../services/integrations/google-play-subscriptions');
    await handleGooglePlayNotification(
      env, userId, integration.id,
      { client_email: creds.client_email, private_key: creds.private_key, package_name: creds.package_name },
      body.purchase_token,
      body.subscription_id || 'manual',
      1 // SUBSCRIPTION_RECOVERED (treat as active)
    );

    // If amount was provided and the lookup returned 0, update it
    if (body.amount) {
      await env.DB.prepare(
        "UPDATE subscriptions SET amount = ? WHERE source = 'google_play' AND source_subscription_id = ? AND amount = 0"
      ).bind(body.amount, body.purchase_token).run();
    }

    // Return the created subscription
    const sub = await env.DB.prepare(
      "SELECT * FROM subscriptions WHERE source = 'google_play' AND source_subscription_id = ?"
    ).bind(body.purchase_token).first();

    return success(sub, 'Subscription added from Google Play');
  } catch (e) {
    console.error('Manual Google Play subscription lookup failed:', e);
    return error('Failed to look up subscription. Please check your integration credentials.');
  }
}

// Google Play Pub/Sub webhook handler (public endpoint, no JWT auth)
export async function handleGooglePlayWebhook(request: Request, env: Env): Promise<Response> {
  // Verify shared secret (header preferred; query param deprecated for backward compat with Pub/Sub)
  const url = new URL(request.url);
  const headerSecret = request.headers.get('X-Webhook-Secret');
  const querySecret = url.searchParams.get('secret');
  if (querySecret && !headerSecret) {
    console.warn('Webhook secret via query param is deprecated. Migrate to X-Webhook-Secret header.');
  }
  const secret = headerSecret || querySecret;

  if (!secret || !env.GOOGLE_PLAY_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Constant-time comparison
  const encoder = new TextEncoder();
  const a = encoder.encode(secret);
  const b = encoder.encode(env.GOOGLE_PLAY_WEBHOOK_SECRET);
  if (a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) {
    return new Response('Unauthorized', { status: 403 });
  }

  try {
    const body = await request.json<{
      message?: { data?: string };
      subscription?: string;
    }>();

    if (!body.message?.data) {
      // Pub/Sub validation request or empty message — acknowledge
      return new Response('OK', { status: 200 });
    }

    // Decode base64 Pub/Sub message
    const decoded = atob(body.message.data);
    const notification = JSON.parse(decoded) as {
      packageName?: string;
      subscriptionNotification?: {
        purchaseToken: string;
        subscriptionId: string;
        notificationType: number;
      };
      oneTimeProductNotification?: unknown;
    };

    // Only handle subscription notifications
    if (!notification.subscriptionNotification) {
      return new Response('OK', { status: 200 });
    }

    const subNotif = notification.subscriptionNotification;
    const packageName = notification.packageName;

    // Find the matching integration by package name
    const integrations = await env.DB.prepare(
      "SELECT id, user_id, credentials FROM integrations WHERE provider = 'google_play' AND is_active = 1"
    ).all<{ id: string; user_id: string; credentials: string }>();

    for (const integration of integrations.results) {
      try {
        const decrypted = await decryptValue(integration.credentials, env.JWT_SECRET, integration.user_id);
        const creds = JSON.parse(decrypted);

        if (creds.package_name === packageName) {
          const { handleGooglePlayNotification } = await import('../services/integrations/google-play-subscriptions');
          await handleGooglePlayNotification(
            env, integration.user_id, integration.id,
            { client_email: creds.client_email, private_key: creds.private_key, package_name: creds.package_name },
            subNotif.purchaseToken, subNotif.subscriptionId, subNotif.notificationType
          );
          break;
        }
      } catch (e) {
        console.error(`Webhook handler error for integration ${integration.id}:`, e);
      }
    }

    // Always return 200 to prevent Pub/Sub retries
    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Google Play webhook error:', e);
    // Still return 200 to prevent infinite retries
    return new Response('OK', { status: 200 });
  }
}
