# WeaveLedger

Smart expense tracking for freelancers and small business owners. Self-hosted on Cloudflare Workers -- you own your data.

[![Deploy to Cloudflare](https://static.weavehub.app/cf-button.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/WeaveHubHQ/weaveledger-oss/tree/main/api)

<a href="https://www.buymeacoffee.com/jasonlazerus"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" height="50" width="217" alt="Buy Me A Coffee"></a>

## Features

- **AI Receipt Scanning** -- Snap a photo, AI extracts merchant, amount, date, and category (Claude or GPT-4o)
- **Expense Tracking** -- Categorize, search, filter, and manage all business expenses
- **Subscription Analytics** -- Track MRR/ARR across Stripe, Google Play, and Apple App Store
- **Revenue Forecasting** -- 12-month revenue projections from active subscriptions
- **Budget Management** -- Set budgets by category, track spending vs limits
- **Tax Ready** -- Tax category tracking, deduction estimates, Schedule C support
- **Multi-format Export** -- CSV, JSON, PDF, QBO, OFX
- **Email Receipt Forwarding** -- Forward receipts to your instance for automatic processing
- **Self-Hosted** -- Runs entirely on Cloudflare's free tier (Workers, D1, R2)

---

## Prerequisites

Before you begin, make sure you have:

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Node.js](https://nodejs.org/) 18 or later
- npm (included with Node.js)
- Wrangler CLI authenticated:

```bash
npx wrangler login
```

This opens a browser window where you authorize Wrangler to manage your Cloudflare account.

---

## Unlock All Features (Self-Hosters)

> **This is the most important step for self-hosted deployments.**

By default, `wrangler.toml` ships with `SUBSCRIPTION_ENFORCEMENT = "licensing"`, which gates certain features behind WeaveLedger's commercial licensing server. **Self-hosters must change this to `"none"` to unlock all features.**

Open `api/wrangler.toml` and change the `[vars]` section:

```toml
[vars]
SUBSCRIPTION_ENFORCEMENT = "none"
# LICENSING_URL = "https://licensing.weavehub.app"  # not needed when enforcement is "none"
```

If you skip this step, routes for books, receipts, budgets, tax, subscriptions, and exports will return `403 Forbidden` with a subscription-required error.

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/WeaveHubHQ/weaveledger-oss.git
cd weaveledger-oss/api
npm install
```

### 2. Create Cloudflare Resources

```bash
# Create the D1 database
npx wrangler d1 create weaveledger-db
```

Wrangler prints output like this:

```
Created database 'weaveledger-db'
database_id = "abc12345-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy that `database_id` value and paste it into `wrangler.toml`:**

```toml
[[d1_databases]]
binding = "DB"
database_name = "weaveledger-db"
database_id = "abc12345-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # <-- paste your ID here
```

Then create the R2 storage bucket:

```bash
npx wrangler r2 bucket create weaveledger-receipts
```

### 3. Set Subscription Enforcement

If you have not already, change `SUBSCRIPTION_ENFORCEMENT` to `"none"` in `wrangler.toml` (see [Unlock All Features](#unlock-all-features-self-hosters) above).

### 4. Run Database Migrations

Apply all 13 migrations to set up the database schema:

```bash
for f in migrations/*.sql; do
  npx wrangler d1 execute weaveledger-db --file="$f" --remote
done
```

See [Database Migrations](#database-migrations) below for what each migration does.

### 5. Set Secrets

```bash
# Required: JWT signing secret (generate a random string)
npx wrangler secret put JWT_SECRET

# For AI receipt scanning (at least one):
npx wrangler secret put CLAUDE_API_KEY    # Anthropic API key
npx wrangler secret put OPENAI_API_KEY    # OpenAI API key
```

### 6. Deploy

```bash
npx wrangler deploy
```

Wrangler prints your Worker URL (e.g., `https://weaveledger-api.<your-subdomain>.workers.dev`).

### 7. Verify the Deployment

```bash
curl https://weaveledger-api.<your-subdomain>.workers.dev/api/health
```

You should see:

```json
{"status":"ok","version":"1.2.0"}
```

Register your first user:

```bash
curl -X POST https://weaveledger-api.<your-subdomain>.workers.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"YourSecurePassword123!","name":"Your Name"}'
```

You are now ready to connect the iOS app.

---

## Connect the iOS App

The WeaveLedger iOS app is available on the App Store. To connect it to your self-hosted instance:

1. Open the WeaveLedger app on your iPhone or iPad
2. On the login screen, tap **Server Configuration** (below the login form)
3. Enter your Worker URL: `https://weaveledger-api.<your-subdomain>.workers.dev`
4. Tap **Save**
5. Register a new account or log in with the credentials you created above

The app stores your server URL locally and sends all requests to your self-hosted instance.

---

## Database Migrations

The `api/migrations/` directory contains 13 migrations that must be applied in order. The `for` loop in the Quick Start handles this automatically.

| File | Description |
|------|-------------|
| `0001_initial.sql` | Core schema: users, books, book_shares, receipts, rate_limits |
| `0002_mfa.sql` | Multi-factor authentication (TOTP) fields on users |
| `0003_roles_invitations.sql` | Role-based sharing (reader/member/admin) and invitation system |
| `0004_user_emails.sql` | Linked email addresses for receipt capture attribution |
| `0005_attachments.sql` | Multiple file attachments per receipt |
| `0006_ai_provider_receipt_numbers.sql` | AI provider preference, receipt/invoice number fields for dedup |
| `0007_user_api_keys.sql` | Per-user encrypted API keys (Anthropic, OpenAI) |
| `0008_income_tracking.sql` | Income integrations and transactions (Stripe, Google Play, Apple) |
| `0009_subscriptions.sql` | Subscription tracking for MRR/ARR revenue forecasting |
| `0010_account_lockout.sql` | Failed login lockout, password reset tokens |
| `0011_budgets_tax_recurring.sql` | Budgets, tax settings, recurring expense schedules |
| `0012_token_version.sql` | Session invalidation on password change or MFA toggle |
| `0013_app_subscriptions.sql` | WeaveLedger app subscription tracking (Apple IAP) |

---

## API Endpoints

All endpoints are under `/api/`. Routes marked with a lock require a valid JWT in the `Authorization: Bearer <token>` header. Routes marked with a dollar sign are gated by subscription enforcement.

### Public Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Log in (returns JWT) |
| `POST` | `/api/auth/forgot-password` | Request password reset |
| `POST` | `/api/auth/reset-password` | Reset password with token |
| `POST` | `/api/auth/refresh` | Refresh an auth token |
| `POST` | `/api/webhooks/google-play` | Google Play RTDN webhook |
| `POST` | `/api/webhooks/apple-notifications` | Apple App Store Server Notifications |

### Auth (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/api/auth/password` | Change password |
| `GET` | `/api/auth/profile` | Get user profile |
| `PUT` | `/api/auth/preferences` | Update preferences |
| `POST` | `/api/auth/mfa/setup` | Begin MFA setup |
| `POST` | `/api/auth/mfa/enable` | Enable MFA |
| `POST` | `/api/auth/mfa/disable` | Disable MFA |
| `GET` | `/api/auth/emails` | List linked emails |
| `POST` | `/api/auth/emails` | Add linked email |
| `DELETE` | `/api/auth/emails/:id` | Remove linked email |

### App Subscription (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/app-subscription/verify` | Verify Apple IAP receipt |
| `GET` | `/api/app-subscription/status` | Get subscription status |
| `POST` | `/api/app-subscription/restore` | Restore purchase |

### Books (authenticated, paid)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/books` | List books |
| `POST` | `/api/books` | Create a book |
| `GET` | `/api/books/:id` | Get a book |
| `PUT` | `/api/books/:id` | Update a book |
| `DELETE` | `/api/books/:id` | Delete a book |
| `POST` | `/api/books/:id/shares` | Share a book |
| `DELETE` | `/api/books/:id/shares/:shareId` | Revoke share |
| `GET` | `/api/books/:id/invitations` | List invitations |
| `DELETE` | `/api/books/:id/invitations/:invId` | Revoke invitation |
| `GET` | `/api/books/:id/summary` | Book summary |

### Receipts (authenticated, paid)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/books/:id/receipts` | List receipts |
| `POST` | `/api/books/:id/receipts` | Create receipt |
| `POST` | `/api/books/:id/receipts/upload` | Upload receipt image (AI scan) |
| `GET` | `/api/books/:id/receipts/:rid` | Get receipt |
| `PUT` | `/api/books/:id/receipts/:rid` | Update receipt |
| `DELETE` | `/api/books/:id/receipts/:rid` | Delete receipt |
| `POST` | `/api/books/:id/receipts/:rid/retry` | Retry AI processing |
| `GET` | `/api/books/:id/receipts/:rid/image` | Get receipt image |
| `GET` | `/api/books/:id/receipts/:rid/attachments/:idx` | Get attachment |

### Export (authenticated, paid)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/books/:id/export/:format/token` | Generate download token |
| `GET` | `/api/books/:id/export/:format` | Download export (csv, json, pdf, qbo, ofx) |

### Income & Integrations (authenticated, paid)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/integrations` | List integrations |
| `POST` | `/api/integrations` | Add/update integration |
| `DELETE` | `/api/integrations/:id` | Remove integration |
| `POST` | `/api/integrations/:id/sync` | Trigger sync |
| `GET` | `/api/income` | List income transactions |
| `GET` | `/api/income/summary` | Income summary |

### Subscriptions (authenticated, paid)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/subscriptions` | List tracked subscriptions |
| `GET` | `/api/subscriptions/summary` | MRR/ARR summary |
| `GET` | `/api/subscriptions/forecast` | 12-month revenue forecast |
| `POST` | `/api/integrations/:id/sync-subscriptions` | Sync subscriptions |

### Budgets (authenticated, paid)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/books/:id/budgets` | List budgets |
| `POST` | `/api/books/:id/budgets` | Create budget |
| `PUT` | `/api/books/:id/budgets/:bid` | Update budget |
| `DELETE` | `/api/books/:id/budgets/:bid` | Delete budget |
| `GET` | `/api/books/:id/budgets/status` | Budget status (spending vs limits) |

### Tax (authenticated, paid)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tax-categories` | List tax categories |
| `GET` | `/api/tax-settings` | Get tax settings |
| `PUT` | `/api/tax-settings` | Update tax settings |
| `GET` | `/api/books/:id/tax-summary` | Tax summary for a book |
| `GET` | `/api/books/:id/tax-estimates` | Tax estimates for a book |

### Profit & Loss (authenticated, paid)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/books/:id/pnl` | Profit and loss report |

---

## Daily Sync (Cron)

WeaveLedger runs a scheduled job every day at **6:00 AM UTC**. The cron trigger is defined in `wrangler.toml`:

```toml
[triggers]
crons = ["0 6 * * *"]
```

Each run performs two tasks:

1. **Sync all active integrations** -- Pulls the latest transactions from Stripe, Google Play, and Apple App Store for every user who has configured an integration.
2. **Advance recurring expenses** -- Generates expense entries for any recurring expenses that are due.

No configuration is needed beyond deployment. The cron runs automatically on Cloudflare's scheduler.

---

## Email Receipt Forwarding (Optional)

You can forward email receipts to your WeaveLedger instance for automatic AI-powered processing. This requires a domain on Cloudflare.

### Setup

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to your domain > **Email** > **Email Routing**
2. Enable Email Routing for your domain if not already enabled
3. Create a routing rule:
   - **Custom address**: `receipts@yourdomain.com` (or any address you prefer)
   - **Action**: Send to a Worker
   - **Destination Worker**: `weaveledger-api`
4. Uncomment the email routing section in `wrangler.toml`:

```toml
[[email_routing]]
enabled = true
```

5. Redeploy:

```bash
npx wrangler deploy
```

### Usage

Forward any receipt email to `receipts@yourdomain.com`. WeaveLedger matches the sender's email address to a registered user (or their linked emails) and processes any image attachments through the AI receipt scanner.

---

## CORS Configuration

The API ships with a hardcoded CORS origin of `https://ledger.weavehub.app`. This is the hosted web dashboard and does not affect the iOS app (native apps do not send CORS headers).

**If you are building a custom web frontend** for your self-hosted instance, you need to update the `ALLOWED_ORIGIN` constant in `api/src/index.ts`:

```typescript
const ALLOWED_ORIGIN = 'https://your-custom-domain.com';
```

Search for `ledger.weavehub.app` in `api/src/index.ts` and replace both occurrences (the preflight handler and the response wrapper). Then redeploy.

---

## Optional Integrations

### Stripe

Add your Stripe secret key through the app's Settings > Integrations. WeaveLedger syncs your balance transactions and subscription data.

### Google Play

1. Create a service account in Google Cloud Console with the `androidpublisher` scope
2. Add the service account credentials through the app's Settings > Integrations
3. Set up Real-Time Developer Notifications (RTDN):
   - Create a Pub/Sub topic in your GCP project
   - Create a push subscription pointing to `https://your-worker.example.com/api/webhooks/google-play?secret=YOUR_SECRET`
   - Set the webhook secret: `npx wrangler secret put GOOGLE_PLAY_WEBHOOK_SECRET`
   - Configure the topic in Google Play Console > Settings > Real-time notifications

### Apple App Store

1. Create an App Store Connect API key with Finance role
2. Add the credentials (issuer ID, key ID, private key, vendor number) through the app's Settings > Integrations
3. Optionally, create an Admin-role key for real-time subscription cancellation detection

---

## Custom Domain (Optional)

By default, your API is served at `https://weaveledger-api.<your-subdomain>.workers.dev`. To use a custom domain:

1. Add your domain to Cloudflare (it must use Cloudflare DNS)
2. Uncomment and edit the `routes` section in `wrangler.toml`:

```toml
routes = [
  { pattern = "ledger.yourdomain.com", custom_domain = true }
]
```

3. Redeploy:

```bash
npx wrangler deploy
```

Cloudflare automatically provisions an SSL certificate for the custom domain.

---

## Demo / Testing Data

The file `api/seed-demo.sql` contains sample data for testing and demo purposes. It was originally created for Apple App Review but is useful for anyone who wants to see the app populated with realistic data.

To use it:

1. First, register a demo user via the API (the seed SQL expects the user to exist):

```bash
curl -X POST https://your-worker.workers.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@weaveledger.app","password":"DemoPass123!","name":"Demo User"}'
```

2. Then apply the seed data:

```bash
npx wrangler d1 execute weaveledger-db --file=seed-demo.sql --remote
```

---

## Architecture

```
+-------------------------------------------------+
| Cloudflare Worker (weaveledger-api)              |
|                                                  |
|  Routes -> Middleware (JWT Auth, Rate Limiting)   |
|  -> Services -> D1 Database + R2 Storage         |
|                                                  |
|  Cron: Daily sync at 6 AM UTC                    |
|  Email: Forward receipts for auto-processing     |
|  Webhooks: Google Play RTDN, Apple Notifications |
+-------------------------------------------------+
```

| Component | Service | Free Tier |
|-----------|---------|-----------|
| API & Logic | Cloudflare Workers | 100K requests/day |
| Database | Cloudflare D1 (SQLite) | 5M rows read/day |
| File Storage | Cloudflare R2 | 10 GB |
| AI Processing | Claude or GPT-4o | Bring your own key |

---

## Development

```bash
cd api
npm install
npx wrangler dev  # Start local dev server on http://localhost:8787
```

### npm Scripts

The `package.json` includes a few convenience scripts. Note that the migration scripts only run individual migrations, not the full set:

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `wrangler dev` | Start local development server |
| `npm run deploy` | `wrangler deploy` | Deploy to Cloudflare |
| `npm run db:migrate` | `wrangler d1 execute ... --file=0001_initial.sql` | Run only the initial migration (remote) |
| `npm run db:migrate:local` | Same as above with `--local` | Run only the initial migration (local) |

**To run all migrations**, use the `for` loop from the Quick Start section rather than these scripts.

---

## Updating

To pull the latest version and apply any new migrations:

```bash
cd weaveledger-oss
git pull origin main

cd api
npm install

# Run all migrations (already-applied migrations are idempotent)
for f in migrations/*.sql; do
  npx wrangler d1 execute weaveledger-db --file="$f" --remote
done

npx wrangler deploy
```

Check the [releases page](https://github.com/WeaveHubHQ/weaveledger-oss/releases) for migration notes and breaking changes before updating.

---

## Troubleshooting

### "subscription required" / 403 Forbidden on most routes

You have not set `SUBSCRIPTION_ENFORCEMENT = "none"` in `wrangler.toml`. See [Unlock All Features](#unlock-all-features-self-hosters).

### `database_id` is empty / D1 errors on deploy

After running `npx wrangler d1 create weaveledger-db`, you must copy the `database_id` from the output and paste it into `wrangler.toml`. The default value is an empty string.

### Migration fails with "table already exists"

This is safe to ignore. The migrations use `CREATE TABLE IF NOT EXISTS` for new tables. `ALTER TABLE` statements may fail if re-run, but this does not corrupt data. You can safely re-run the full migration loop.

### "Unauthorized" on every request

Your JWT_SECRET is not set, or the token has expired. Verify the secret is configured:

```bash
npx wrangler secret list
```

If `JWT_SECRET` is missing, set it again with `npx wrangler secret put JWT_SECRET`.

### AI receipt scanning returns empty results

Make sure at least one AI API key is set:

```bash
npx wrangler secret put CLAUDE_API_KEY
# or
npx wrangler secret put OPENAI_API_KEY
```

### CORS errors in the browser

The API only allows requests from `https://ledger.weavehub.app` by default. If you are building a web client, update the `ALLOWED_ORIGIN` in `api/src/index.ts`. See [CORS Configuration](#cors-configuration).

### Email forwarding does not process receipts

1. Verify Email Routing is enabled on your domain in Cloudflare dashboard
2. Verify the routing rule points to the `weaveledger-api` Worker
3. Verify the sender's email matches a registered user or one of their linked emails
4. Check Worker logs: `npx wrangler tail`

### Rate limiting / 429 Too Many Requests

The API applies per-IP rate limits on public routes (registration, login, password reset). Wait 60 seconds and try again.

---

## License

MIT License -- see [LICENSE](LICENSE) for details.

Made by [WeaveHub Technologies](https://weavehub.app)
