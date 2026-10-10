import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handleRevenueCatWebhook } from '../src/routes/revenuecat-webhook';
import { isProActive } from '../src/middleware/auth';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function fixture() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, subscription_tier TEXT, subscription_expires_at TEXT,
      rc_last_event_ms INTEGER DEFAULT 0, rc_product_id TEXT, updated_at TEXT);
    CREATE TABLE webhook_events (id TEXT, source TEXT, event_id TEXT, event_type TEXT,
      payload TEXT, processed_at TEXT, process_status TEXT, UNIQUE(source, event_id));
  `);
  const expiry = new Date(Date.now() + 86400000).toISOString();
  sqlite.query('INSERT INTO users VALUES (?, ?, ?, ?, ?, NULL)').run('usr_recipient', 'pro', expiry, 0, 'old-product');
  const DB = {
    prepare(query: string) {
      return { bind(...args: any[]) {
        return { query, args,
          async run() { return { meta: { changes: sqlite.query(query).run(...args).changes } }; },
          async first() { return sqlite.query(query).get(...args); },
        };
      } };
    },
    async batch(statements: any[]) {
      return sqlite.transaction(() => statements.map(({ query, args }) =>
        ({ meta: { changes: sqlite.query(query).run(...args).changes } })))();
    },
  };
  const env: any = { DB, RC_WEBHOOK_SECRET: 'test-only', RC_API_KEY: 'mock-only', RC_PROJECT_ID: 'test-project' };
  const eventMs = Date.now();
  const deliver = () => handleRevenueCatWebhook(new Request('https://test.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: { id: 'transfer-1', type: 'TRANSFER', environment: 'PRODUCTION',
      event_timestamp_ms: eventMs, transferred_from: ['$RCAnonymousID:source'], transferred_to: ['usr_recipient'] } }),
  }), env);
  const user = () => sqlite.query('SELECT * FROM users WHERE id = ?').get('usr_recipient') as any;
  return { sqlite, env, expiry, eventMs, deliver, user };
}

function lookup(items: any[]) {
  globalThis.fetch = (async () => Response.json({ items })) as any;
}

test('transfer removes stale paid access when RevenueCat reports no entitlement', async () => {
  const f = fixture(); lookup([]);
  expect((await f.deliver()).status).toBe(200);
  expect(isProActive(f.user())).toBe(false);
  expect(f.user().subscription_tier).toBe('free');
  expect(f.user().rc_last_event_ms).toBe(f.eventMs);
});

test('sandbox-only transfer removes stale production access', async () => {
  const f = fixture();
  lookup([{ gives_access: true, environment: 'sandbox', current_period_ends_at: Date.now() + 86400000,
    entitlements: { items: [{ lookup_key: 'pro' }] } }]);
  await f.deliver();
  expect(isProActive(f.user())).toBe(false);
});

test('older denied transfer cannot revoke a newer renewal', async () => {
  const f = fixture(); lookup([]);
  f.sqlite.query('UPDATE users SET rc_last_event_ms = ?').run(f.eventMs + 1000);
  await f.deliver();
  expect(isProActive(f.user())).toBe(true);
  expect(f.user().rc_product_id).toBe('old-product');
});

test('anonymous transfer grants usable access from the v2 lookup', async () => {
  const f = fixture();
  f.sqlite.exec("UPDATE users SET subscription_tier = 'free', subscription_expires_at = NULL");
  lookup([{ gives_access: true, environment: 'production', current_period_ends_at: Date.now() + 86400000,
    entitlements: { items: [{ lookup_key: 'pro' }] } }]);
  await f.deliver();
  expect(isProActive(f.user())).toBe(true);
});

test('failed lookup leaves entitlement unchanged and allows redelivery', async () => {
  const f = fixture(); globalThis.fetch = (async () => new Response('', { status: 503 })) as any;
  expect((await f.deliver()).status).toBe(500);
  expect(isProActive(f.user())).toBe(true);
  expect(f.sqlite.query('SELECT COUNT(*) AS n FROM webhook_events').get()).toEqual({ n: 0 });
  lookup([]);
  expect((await f.deliver()).status).toBe(200);
  expect(isProActive(f.user())).toBe(false);
});
