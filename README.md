# WeaveLedger

Smart expense tracking for freelancers and small business owners. Self-hosted on Cloudflare Workers — you own your data.

[![Deploy to Cloudflare](https://static.weavehub.app/cf-button.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/WeaveHubHQ/weaveledger-oss)

<a href="https://www.buymeacoffee.com/jasonlazerus"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" height="50" width="217" alt="Buy Me A Coffee"></a>

## Features

- **AI Receipt Scanning** — Snap a photo, AI extracts merchant, amount, date, and category (Claude or GPT-4o)
- **Expense Tracking** — Categorize, search, filter, and manage all business expenses
- **Subscription Analytics** — Track MRR/ARR across Stripe, Google Play, and Apple App Store
- **Revenue Forecasting** — 12-month revenue projections from active subscriptions
- **Budget Management** — Set budgets by category, track spending vs limits
- **Tax Ready** — Tax category tracking, deduction estimates, Schedule C support
- **Multi-format Export** — CSV, JSON, PDF, QBO, OFX
- **Email Receipt Forwarding** — Forward receipts to your instance for automatic processing
- **Self-Hosted** — Runs entirely on Cloudflare's free tier (Workers, D1, R2)

## Quick Start

### 1. Deploy to Cloudflare

Click the deploy button above, or deploy manually:

```bash
git clone https://github.com/WeaveHubHQ/weaveledger.git
cd weaveledger/api
npm install
```

### 2. Create Resources

```bash
# Create the D1 database
npx wrangler d1 create weaveledger-db
# Copy the database_id from the output into wrangler.toml

# Create the R2 bucket
npx wrangler r2 bucket create weaveledger-receipts

# Run database migrations
for f in migrations/*.sql; do
  npx wrangler d1 execute weaveledger-db --file="$f" --remote
done
```

### 3. Set Secrets

```bash
# Required: JWT signing secret (generate a random string)
npx wrangler secret put JWT_SECRET

# For AI receipt scanning (at least one):
npx wrangler secret put CLAUDE_API_KEY    # Anthropic API key
npx wrangler secret put OPENAI_API_KEY    # OpenAI API key
```

### 4. Deploy

```bash
npx wrangler deploy
```

Your API is now live. Connect the WeaveLedger iOS app by entering your Worker URL in the Server Configuration on the login screen.

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

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Cloudflare Worker (weaveledger-api)              │
│                                                  │
│  Routes → Middleware (JWT Auth, Rate Limiting)   │
│  → Services → D1 Database + R2 Storage           │
│                                                  │
│  Cron: Daily sync at 6 AM UTC                    │
│  Email: Forward receipts for auto-processing     │
│  Webhooks: Google Play RTDN                      │
└─────────────────────────────────────────────────┘
```

| Component | Service | Free Tier |
|-----------|---------|-----------|
| API & Logic | Cloudflare Workers | 100K requests/day |
| Database | Cloudflare D1 (SQLite) | 5M rows read/day |
| File Storage | Cloudflare R2 | 10 GB |
| AI Processing | Claude or GPT-4o | Bring your own key |

## iOS App

The WeaveLedger iOS app is available on the App Store. It connects to your self-hosted instance and provides:

- Dashboard with expense overview and charts
- Camera receipt scanning
- Expense and receipt management
- Subscription tracking (MRR/ARR)
- Budget and tax management

## Development

```bash
cd api
npm install
npx wrangler dev  # Start local dev server
```

## License

MIT License — see [LICENSE](LICENSE) for details.

Made by [WeaveHub Technologies](https://weavehub.app)
