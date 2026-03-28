import { Env } from '../types';
import { generateId, encryptValue, decryptValue } from '../utils/crypto';
import { error, success } from '../utils/response';

type Provider = 'stripe' | 'google_play' | 'apple_app_store';

export async function listIntegrations(request: Request, env: Env, userId: string): Promise<Response> {
  const results = await env.DB.prepare(
    'SELECT id, provider, is_active, last_sync_at, last_sync_status, last_sync_error, created_at FROM integrations WHERE user_id = ?'
  ).bind(userId).all();

  return success(results.results);
}

export async function upsertIntegration(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{ provider: string; credentials: Record<string, string> }>();

  const validProviders: Provider[] = ['stripe', 'google_play', 'apple_app_store'];
  if (!validProviders.includes(body.provider as Provider)) {
    return error('Invalid provider. Must be: stripe, google_play, or apple_app_store.');
  }

  // Validate required credential fields
  const provider = body.provider as Provider;
  if (provider === 'stripe' && !body.credentials.api_key) {
    return error('Stripe API key is required.');
  }
  if (provider === 'google_play' && (!body.credentials.client_email || !body.credentials.private_key || !body.credentials.package_name)) {
    return error('Google Play requires client_email, private_key, and package_name.');
  }
  if (provider === 'apple_app_store' && (!body.credentials.issuer_id || !body.credentials.key_id || !body.credentials.private_key || !body.credentials.vendor_number)) {
    return error('Apple App Store requires issuer_id, key_id, private_key, and vendor_number.');
  }

  const encrypted = await encryptValue(JSON.stringify(body.credentials), env.JWT_SECRET, userId);

  // Upsert: update if exists, insert if not
  const existing = await env.DB.prepare(
    'SELECT id FROM integrations WHERE user_id = ? AND provider = ?'
  ).bind(userId, provider).first<{ id: string }>();

  if (existing) {
    await env.DB.prepare(
      "UPDATE integrations SET credentials = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(encrypted, existing.id).run();
    return success({ id: existing.id }, 'Integration updated');
  }

  const id = generateId('int');
  await env.DB.prepare(
    'INSERT INTO integrations (id, user_id, provider, credentials) VALUES (?, ?, ?, ?)'
  ).bind(id, userId, provider, encrypted).run();

  return success({ id }, 'Integration created');
}

export async function deleteIntegration(request: Request, env: Env, userId: string, integrationId: string): Promise<Response> {
  const result = await env.DB.prepare(
    'DELETE FROM integrations WHERE id = ? AND user_id = ?'
  ).bind(integrationId, userId).run();

  if (!result.meta.changes) return error('Integration not found', 404);
  return success(null, 'Integration removed');
}

// Core sync logic reused by both the API route and the scheduled cron handler
async function syncIntegrationCore(
  env: Env,
  integration: { id: string; provider: Provider; credentials: string; last_sync_at: string | null },
  userId: string
): Promise<{ synced: number; errors: string[]; status: string }> {
  const decrypted = await decryptValue(integration.credentials, env.JWT_SECRET, userId);
  const creds: Record<string, string> = JSON.parse(decrypted);

  let result: { synced: number; errors: string[] };

  try {
    switch (integration.provider) {
      case 'stripe': {
        const { syncStripe } = await import('../services/integrations/stripe');
        result = await syncStripe(env, userId, integration.id, creds.api_key, integration.last_sync_at);
        // Also sync subscriptions
        try {
          const { syncStripeSubscriptions } = await import('../services/integrations/stripe-subscriptions');
          await syncStripeSubscriptions(env, userId, integration.id, creds.api_key);
        } catch (e) {
          result.errors.push(`Subscription sync: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        break;
      }
      case 'google_play': {
        const { syncGooglePlay } = await import('../services/integrations/google-play');
        result = await syncGooglePlay(env, userId, integration.id, {
          client_email: creds.client_email,
          private_key: creds.private_key,
          package_name: creds.package_name,
        }, integration.last_sync_at);
        break;
      }
      case 'apple_app_store': {
        const { syncAppleAppStore } = await import('../services/integrations/apple-app-store');
        result = await syncAppleAppStore(env, userId, integration.id, {
          issuer_id: creds.issuer_id,
          key_id: creds.key_id,
          private_key: creds.private_key,
          vendor_number: creds.vendor_number,
        }, integration.last_sync_at);
        // Also sync subscriptions
        try {
          const { syncAppleSubscriptions } = await import('../services/integrations/apple-subscriptions');
          await syncAppleSubscriptions(env, userId, integration.id, {
            issuer_id: creds.issuer_id,
            key_id: creds.key_id,
            private_key: creds.private_key,
            vendor_number: creds.vendor_number,
            server_key_id: creds.server_key_id,
            server_private_key: creds.server_private_key,
          });
        } catch (e) {
          result.errors.push(`Subscription sync: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        break;
      }
      default:
        throw new Error('Unknown provider');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    await env.DB.prepare(
      "UPDATE integrations SET last_sync_status = 'error', last_sync_error = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(msg.slice(0, 500), integration.id).run();
    throw e;
  }

  const status = result.errors.length > 0 ? 'partial' : 'success';
  await env.DB.prepare(
    "UPDATE integrations SET last_sync_at = datetime('now'), last_sync_status = ?, last_sync_error = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(status, result.errors.length > 0 ? result.errors.join('; ').slice(0, 500) : null, integration.id).run();

  return { synced: result.synced, errors: result.errors, status };
}

export async function syncIntegration(request: Request, env: Env, userId: string, integrationId: string): Promise<Response> {
  const integration = await env.DB.prepare(
    'SELECT id, provider, credentials, last_sync_at FROM integrations WHERE id = ? AND user_id = ?'
  ).bind(integrationId, userId).first<{ id: string; provider: Provider; credentials: string; last_sync_at: string | null }>();

  if (!integration) return error('Integration not found', 404);

  try {
    const result = await syncIntegrationCore(env, integration, userId);
    return success(result, `Synced ${result.synced} transactions`);
  } catch (e) {
    console.error(`Sync failed for integration ${integrationId}:`, e);
    return error('Sync failed. Please check your integration credentials and try again.');
  }
}

// Called by the cron trigger to sync all active integrations
export async function syncAllIntegrations(env: Env): Promise<void> {
  const integrations = await env.DB.prepare(
    'SELECT i.id, i.provider, i.credentials, i.last_sync_at, i.user_id FROM integrations i WHERE i.is_active = 1'
  ).all<{ id: string; provider: Provider; credentials: string; last_sync_at: string | null; user_id: string }>();

  for (const integration of integrations.results) {
    try {
      const result = await syncIntegrationCore(env, integration, integration.user_id);
      console.log(`Cron sync ${integration.provider} (${integration.id}): ${result.synced} synced, ${result.errors.length} errors`);
    } catch (e) {
      console.error(`Cron sync failed for ${integration.provider} (${integration.id}):`, e);
    }
  }
}

export async function listIncomeTransactions(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');
  const page = Math.max(parseInt(url.searchParams.get('page') || '1') || 1, 1);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 100);
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM income_transactions WHERE user_id = ?';
  let countQuery = 'SELECT COUNT(*) as total FROM income_transactions WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (source) { query += ' AND source = ?'; countQuery += ' AND source = ?'; params.push(source); }
  if (dateFrom) { query += ' AND transaction_date >= ?'; countQuery += ' AND transaction_date >= ?'; params.push(dateFrom); }
  if (dateTo) { query += ' AND transaction_date <= ?'; countQuery += ' AND transaction_date <= ?'; params.push(dateTo); }

  const total = await env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();

  query += ' ORDER BY transaction_date DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const results = await env.DB.prepare(query).bind(...params).all();

  return success({
    transactions: results.results,
    pagination: {
      page, limit,
      total: total?.total || 0,
      pages: Math.ceil((total?.total || 0) / limit),
    },
  });
}

export async function getIncomeSummary(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  let dateFilter = '';
  const params: string[] = [userId];
  if (dateFrom) { dateFilter += ' AND transaction_date >= ?'; params.push(dateFrom); }
  if (dateTo) { dateFilter += ' AND transaction_date <= ?'; params.push(dateTo); }

  const overview = await env.DB.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_cents, COALESCE(SUM(net_amount), 0) as net_cents, COALESCE(SUM(fee_amount), 0) as fee_cents
     FROM income_transactions WHERE user_id = ?${dateFilter}`
  ).bind(...params).first();

  const bySource = await env.DB.prepare(
    `SELECT source, COUNT(*) as count, COALESCE(SUM(amount), 0) as total_cents
     FROM income_transactions WHERE user_id = ?${dateFilter}
     GROUP BY source ORDER BY total_cents DESC`
  ).bind(...params).all();

  const byMonth = await env.DB.prepare(
    `SELECT strftime('%Y-%m', transaction_date) as month, COUNT(*) as count, COALESCE(SUM(amount), 0) as total_cents
     FROM income_transactions WHERE user_id = ?${dateFilter}
     GROUP BY month ORDER BY month DESC LIMIT 12`
  ).bind(...params).all();

  return success({
    overview,
    by_source: bySource.results,
    by_month: byMonth.results,
  });
}
