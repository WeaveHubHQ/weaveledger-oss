import { Env } from './types';
import { authenticate, authenticateDownload, checkRateLimit, canAccessBook, requireSubscription } from './middleware/auth';
import { deriveDownloadKey } from './utils/crypto';
import { register, registrationStatus, login, changePassword, getProfile, updatePreferences, getUserApiKey, mfaSetup, mfaEnable, mfaDisable, addLinkedEmail, removeLinkedEmail, listLinkedEmails, resendLinkedEmailVerification, verifyLinkedEmailLink, forgotPassword, resetPassword, refreshAuth } from './routes/auth';
import { getAiUsage, createAiCheckout, createAiKey } from './routes/ai';
import { passkeyRegisterOptions, passkeyRegisterVerify, passkeyLoginOptions, passkeyLoginVerify, listPasskeys, renamePasskey, deletePasskey } from './routes/passkeys';
import { listBooks, createBook, getBook, updateBook, setBookStatus, deleteBook, shareBook, revokeShare, listInvitations, revokeInvitation } from './routes/books';
import { listReceipts, listAllReceipts, createReceipt, getReceipt, updateReceipt, deleteReceipt, uploadReceiptImage, getReceiptImage, getReceiptAttachment, retryReceipt, retryAllFailedReceipts, getBookSummary, cleanupStuckReceipts } from './routes/receipts';
import { exportBook } from './services/export';
import { listIntegrations, upsertIntegration, deleteIntegration, syncIntegration, syncAllIntegrations, listIncomeTransactions, getIncomeSummary, listPayouts, markPayoutReceived, getIncomeDashboard } from './routes/income';
import { triggerReconcile, backfillUsd, backfillFees, listCronRuns } from './routes/admin';
import { generateId } from './utils/crypto';
import { listSubscriptions, getSubscriptionSummary, getSubscriptionForecast, syncSubscriptions, addGooglePlaySubscription, handleGooglePlayWebhook } from './routes/subscriptions';
import { verifyAppSubscription, getAppSubscriptionStatus, restoreAppSubscription, handleAppleNotificationWebhook } from './routes/app-subscription';
import { listBudgets, createBudget, updateBudget, deleteBudget, getBudgetStatus } from './routes/budgets';
import { listReports, createReport, getReport, updateReport, deleteReport, addReportItems, removeReportItem, exportReport } from './routes/reports';
import { uploadStatement, listStatements, getStatement, deleteStatement, matchStatementTransaction, unmatchStatementTransaction, ignoreStatementTransaction, createReceiptFromTransaction } from './routes/statements';
import { listRecurringExpenses, createRecurringExpense, updateRecurringExpense, deleteRecurringExpense, advanceRecurringExpenses } from './routes/recurring-expenses';
import { getTaxCategories, getTaxSettings, updateTaxSettings, getTaxSummary, getTaxEstimates } from './routes/tax';
import { getProfitAndLoss } from './routes/pnl';
import { handleInboundEmail } from './services/email-handler';
import { error, json } from './utils/response';
import { landingPage } from './utils/landing';
import { termsOfServicePage, privacyPolicyPage } from './utils/legal';
import { ExportFormat } from './types';

export { ReceiptProcessorWorkflow } from './workflows/receipt-processor';

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight — only respond with CORS headers for the allowed origin
    if (request.method === 'OPTIONS') {
      const reqOrigin = request.headers.get('Origin') || '';
      if (reqOrigin !== 'https://ledger.weavehub.app') {
        return new Response(null, { status: 204 });
      }
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': 'https://ledger.weavehub.app',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin',
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Add CORS headers only for allowed origins; omit entirely for unknown origins
    const origin = request.headers.get('Origin') || '';
    const ALLOWED_ORIGIN = 'https://ledger.weavehub.app';
    const isAllowedOrigin = origin === ALLOWED_ORIGIN;
    const addCors = (response: Response): Response => {
      if (!isAllowedOrigin) return response;
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
      newHeaders.set('Vary', 'Origin');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    };

    try {
      // Hosted grace mode (set by the dispatcher, never trusted from clients
      // because the dispatcher strips inbound copies): the instance is
      // read-only — login/refresh and all GETs (browsing + export) keep
      // working, everything else is declined with a resubscribe pointer.
      if (request.headers.get('x-tenant-grace') === '1'
          && !['GET', 'HEAD', 'OPTIONS'].includes(method)
          && path !== '/api/auth/login' && path !== '/api/auth/refresh') {
        return addCors(json({
          error: 'This ledger is in read-only mode: the subscription has ended. Browsing and exports still work. Resubscribe at https://weaveledger.app to restore full access.',
        }, 402));
      }

      // Platform-mode internal routes (dispatcher-to-tenant, secret-authed).
      // Mounted only when a DISPATCH_SECRET is configured on this deployment.
      if (path.startsWith('/internal/') && env.DISPATCH_SECRET) {
        if (request.headers.get('x-dispatch-secret') !== env.DISPATCH_SECRET) {
          return error('Forbidden', 403);
        }
        if (path === '/internal/email' && method === 'POST') {
          const body = await request.json<{ from: string; to: string; subject?: string; raw_base64: string }>();
          const rawBytes = Uint8Array.from(atob(body.raw_base64), c => c.charCodeAt(0));
          const shim = {
            from: body.from,
            to: body.to,
            rawSize: rawBytes.length,
            headers: new Headers({ subject: body.subject || '' }),
            raw: new Response(rawBytes).body as ReadableStream,
            setReject: () => {},
          };
          // Await completion: the dispatcher's email handler is the one place
          // that can retry, so surface failures to it rather than backgrounding.
          await handleInboundEmail(shim as never, env);
          return json({ ok: true });
        }
        const cronMatch = path.match(/^\/internal\/cron\/(daily|10min|monthly)$/);
        if (cronMatch && method === 'POST') {
          const cronExpr = cronMatch[1] === 'daily' ? '0 6 * * *' : cronMatch[1] === '10min' ? '*/10 * * * *' : '0 7 1 * *';
          const pending: Promise<unknown>[] = [];
          const shimCtx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => {} };
          await worker.scheduled({ cron: cronExpr, scheduledTime: Date.now(), noRetry: () => {} } as unknown as ScheduledEvent, env, shimCtx as unknown as ExecutionContext);
          await Promise.all(pending);
          return json({ ok: true, cron: cronExpr });
        }
        return error('Not found', 404);
      }

      // Public routes (rate limited)
      if (path === '/api/auth/registration-status' && method === 'GET') {
        return addCors(await registrationStatus(request, env));
      }
      if (path === '/api/auth/register' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 5, 60_000);
        if (limited) return addCors(limited);
        return addCors(await register(request, env));
      }
      if (path === '/api/auth/login' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 10, 60_000);
        if (limited) return addCors(limited);
        return addCors(await login(request, env));
      }
      if (path === '/api/auth/forgot-password' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 3, 60_000);
        if (limited) return addCors(limited);
        return addCors(await forgotPassword(request, env));
      }
      if (path === '/api/auth/reset-password' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 5, 60_000);
        if (limited) return addCors(limited);
        return addCors(await resetPassword(request, env));
      }
      if (path === '/api/auth/refresh' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 20, 60_000);
        if (limited) return addCors(limited);
        return addCors(await refreshAuth(request, env));
      }
      // Passkey login ceremony (public — the assertion IS the authentication)
      if (path === '/api/auth/passkeys/login/options' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 10, 60_000);
        if (limited) return addCors(limited);
        return addCors(await passkeyLoginOptions(request, env));
      }
      if (path === '/api/auth/passkeys/login/verify' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 10, 60_000);
        if (limited) return addCors(limited);
        return addCors(await passkeyLoginVerify(request, env));
      }
      if (path === '/api/health') {
        return addCors(json({ status: 'ok', version: '1.3.1' }));
      }

      // Apple App Site Association (password manager + universal links)
      if (path === '/.well-known/apple-app-site-association' || path === '/apple-app-site-association') {
        return new Response(JSON.stringify({
          webcredentials: { apps: ['Z66VFT3QT8.app.weavehub.WeaveLedger'] },
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Landing page
      if (path === '/' && method === 'GET') {
        return landingPage();
      }

      // Legal pages
      if (path === '/terms' && method === 'GET') {
        return termsOfServicePage();
      }
      if (path === '/privacy' && method === 'GET') {
        return privacyPolicyPage();
      }

      // Linked-email magic-link verification (LED-26). Public — bearer auth
      // IS the token. Path is under /api/ so Cloudflare Access's /api/*
      // bypass rule allows unauth GETs from email clients to reach the worker.
      // Rate-limited to blunt enumeration attempts.
      if (path === '/api/verify-email' && method === 'GET') {
        const limited = await checkRateLimit(request, env.DB, 20, 60_000);
        if (limited) return addCors(limited);
        return addCors(await verifyLinkedEmailLink(request, env));
      }

      // Export via download token (no JWT in URL)
      const exportDlMatch = path.match(/^\/api\/books\/([^/]+)\/export\/(csv|json|pdf|qbo|ofx)$/);
      if (exportDlMatch && method === 'GET' && url.searchParams.has('dl_token')) {
        const dlResult = await authenticateDownload(request, env);
        if (dlResult instanceof Response) return addCors(dlResult);
        return addCors(await exportBook(request, env, dlResult.userId, dlResult.bookId, dlResult.format as ExportFormat));
      }

      // Google Play Pub/Sub webhook (public, shared secret auth)
      if (path === '/api/webhooks/google-play' && method === 'POST') {
        return addCors(await handleGooglePlayWebhook(request, env));
      }

      // Apple App Store Server Notifications webhook (public)
      if (path === '/api/webhooks/apple-notifications' && method === 'POST') {
        return addCors(await handleAppleNotificationWebhook(request, env));
      }

      // All other routes require authentication
      const authResult = await authenticate(request, env);
      if (authResult instanceof Response) {
        return addCors(authResult);
      }
      const userId = authResult.sub;

      // Auth routes
      if (path === '/api/auth/password' && method === 'PUT') {
        return addCors(await changePassword(request, env, userId));
      }
      if (path === '/api/auth/profile' && method === 'GET') {
        return addCors(await getProfile(request, env, userId));
      }
      if (path === '/api/ai/create-key' && method === 'POST') {
        return addCors(await createAiKey(request, env, userId));
      }
      if (path === '/api/ai/usage' && method === 'GET') {
        return addCors(await getAiUsage(request, env, userId));
      }
      if (path === '/api/ai/checkout' && method === 'POST') {
        return addCors(await createAiCheckout(request, env, userId));
      }
      if (path === '/api/auth/preferences' && method === 'PUT') {
        return addCors(await updatePreferences(request, env, userId));
      }

      // MFA routes (rate limited to prevent brute-force)
      if (path === '/api/auth/mfa/setup' && method === 'POST') {
        return addCors(await mfaSetup(request, env, userId));
      }
      if (path === '/api/auth/mfa/enable' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 5, 60_000);
        if (limited) return addCors(limited);
        return addCors(await mfaEnable(request, env, userId));
      }
      if (path === '/api/auth/mfa/disable' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 5, 60_000);
        if (limited) return addCors(limited);
        return addCors(await mfaDisable(request, env, userId));
      }

      // Passkey management routes (authenticated)
      if (path === '/api/auth/passkeys/register/options' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 10, 60_000);
        if (limited) return addCors(limited);
        return addCors(await passkeyRegisterOptions(request, env, userId));
      }
      if (path === '/api/auth/passkeys/register/verify' && method === 'POST') {
        const limited = await checkRateLimit(request, env.DB, 10, 60_000);
        if (limited) return addCors(limited);
        return addCors(await passkeyRegisterVerify(request, env, userId));
      }
      if (path === '/api/auth/passkeys' && method === 'GET') {
        return addCors(await listPasskeys(request, env, userId));
      }
      const passkeyMatch = path.match(/^\/api\/auth\/passkeys\/([^/]+)$/);
      if (passkeyMatch && method === 'PATCH') {
        return addCors(await renamePasskey(request, env, userId, passkeyMatch[1]));
      }
      if (passkeyMatch && method === 'DELETE') {
        return addCors(await deletePasskey(request, env, userId, passkeyMatch[1]));
      }

      // Linked email routes
      if (path === '/api/auth/emails' && method === 'GET') {
        return addCors(await listLinkedEmails(request, env, userId));
      }
      if (path === '/api/auth/emails' && method === 'POST') {
        return addCors(await addLinkedEmail(request, env, userId));
      }
      const emailResendMatch = path.match(/^\/api\/auth\/emails\/([^/]+)\/resend$/);
      if (emailResendMatch && method === 'POST') {
        return addCors(await resendLinkedEmailVerification(request, env, userId, emailResendMatch[1]));
      }
      const emailDeleteMatch = path.match(/^\/api\/auth\/emails\/([^/]+)$/);
      if (emailDeleteMatch && method === 'DELETE') {
        return addCors(await removeLinkedEmail(request, env, userId, emailDeleteMatch[1]));
      }

      // App subscription routes (free — users need these to upgrade)
      if (path === '/api/app-subscription/verify' && method === 'POST') {
        return addCors(await verifyAppSubscription(request, env, userId));
      }
      if (path === '/api/app-subscription/status' && method === 'GET') {
        return addCors(await getAppSubscriptionStatus(request, env, userId));
      }
      if (path === '/api/app-subscription/restore' && method === 'POST') {
        return addCors(await restoreAppSubscription(request, env, userId));
      }

      // S1: Subscription enforcement helper — uses a thunk to avoid eagerly executing the handler
      const paid = async (handler: () => Promise<Response>): Promise<Response> => {
        const check = await requireSubscription(env.DB, userId, env.SUBSCRIPTION_ENFORCEMENT, env.LICENSING_URL);
        if (check) return addCors(check);
        return addCors(await handler());
      };

      // Book routes
      if (path === '/api/books' && method === 'GET') {
        return addCors(await listBooks(request, env, userId));
      }
      if (path === '/api/books' && method === 'POST') {
        return paid(() => createBook(request, env, userId));
      }

      // Book-specific routes
      const bookMatch = path.match(/^\/api\/books\/([^/]+)$/);
      if (bookMatch) {
        const bookId = bookMatch[1];
        if (method === 'GET') return addCors(await getBook(request, env, userId, bookId));
        if (method === 'PUT' || method === 'PATCH') return paid(() => updateBook(request, env, userId, bookId));
        if (method === 'DELETE') return paid(() => deleteBook(request, env, userId, bookId));
      }

      // Close / reopen a book (owner-only; not subscription-gated so a book can
      // always be reopened or finalized regardless of billing state).
      const bookStatusMatch = path.match(/^\/api\/books\/([^/]+)\/status$/);
      if (bookStatusMatch && (method === 'PUT' || method === 'POST')) {
        return addCors(await setBookStatus(request, env, userId, bookStatusMatch[1]));
      }

      // Book sharing
      const shareMatch = path.match(/^\/api\/books\/([^/]+)\/shares$/);
      if (shareMatch && method === 'POST') {
        return paid(() => shareBook(request, env, userId, shareMatch[1]));
      }

      const revokeMatch = path.match(/^\/api\/books\/([^/]+)\/shares\/([^/]+)$/);
      if (revokeMatch && method === 'DELETE') {
        return paid(() => revokeShare(request, env, userId, revokeMatch[1], revokeMatch[2]));
      }

      // Invitation routes
      const invitationsMatch = path.match(/^\/api\/books\/([^/]+)\/invitations$/);
      if (invitationsMatch && method === 'GET') {
        return addCors(await listInvitations(request, env, userId, invitationsMatch[1]));
      }

      const revokeInviteMatch = path.match(/^\/api\/books\/([^/]+)\/invitations\/([^/]+)$/);
      if (revokeInviteMatch && method === 'DELETE') {
        return addCors(await revokeInvitation(request, env, userId, revokeInviteMatch[1], revokeInviteMatch[2]));
      }

      // Book summary
      const summaryMatch = path.match(/^\/api\/books\/([^/]+)\/summary$/);
      if (summaryMatch && method === 'GET') {
        return addCors(await getBookSummary(request, env, userId, summaryMatch[1]));
      }

      // Receipt routes
      if (path === '/api/receipts' && method === 'GET') {
        return addCors(await listAllReceipts(request, env, userId));
      }
      const receiptsMatch = path.match(/^\/api\/books\/([^/]+)\/receipts$/);
      if (receiptsMatch) {
        const bookId = receiptsMatch[1];
        if (method === 'GET') return addCors(await listReceipts(request, env, userId, bookId));
        if (method === 'POST') return paid(() => createReceipt(request, env, userId, bookId));
      }

      // Receipt image upload
      const uploadMatch = path.match(/^\/api\/books\/([^/]+)\/receipts\/upload$/);
      if (uploadMatch && method === 'POST') {
        return paid(() => uploadReceiptImage(request, env, userId, uploadMatch[1], (p) => ctx.waitUntil(p)));
      }

      // Single receipt routes
      const receiptMatch = path.match(/^\/api\/books\/([^/]+)\/receipts\/([^/]+)$/);
      if (receiptMatch) {
        const [, bookId, receiptId] = receiptMatch;
        if (method === 'GET') return addCors(await getReceipt(request, env, userId, bookId, receiptId));
        if (method === 'PUT' || method === 'PATCH') return paid(() => updateReceipt(request, env, userId, bookId, receiptId));
        if (method === 'DELETE') return paid(() => deleteReceipt(request, env, userId, bookId, receiptId));
      }

      // Receipt retry (bulk first: "retry-failed" would otherwise match the per-receipt pattern)
      const retryAllMatch = path.match(/^\/api\/books\/([^/]+)\/receipts\/retry-failed$/);
      if (retryAllMatch && method === 'POST') {
        return paid(() => retryAllFailedReceipts(request, env, userId, retryAllMatch[1], (p) => ctx.waitUntil(p)));
      }
      const retryMatch = path.match(/^\/api\/books\/([^/]+)\/receipts\/([^/]+)\/retry$/);
      if (retryMatch && method === 'POST') {
        return paid(() => retryReceipt(request, env, userId, retryMatch[1], retryMatch[2], (p) => ctx.waitUntil(p)));
      }

      // Receipt image
      const imageMatch = path.match(/^\/api\/books\/([^/]+)\/receipts\/([^/]+)\/image$/);
      if (imageMatch && method === 'GET') {
        return addCors(await getReceiptImage(request, env, userId, imageMatch[1], imageMatch[2]));
      }

      // Receipt attachment by index
      const attachMatch = path.match(/^\/api\/books\/([^/]+)\/receipts\/([^/]+)\/attachments\/(\d+)$/);
      if (attachMatch && method === 'GET') {
        return addCors(await getReceiptAttachment(request, env, userId, attachMatch[1], attachMatch[2], attachMatch[3]));
      }

      // Generate short-lived download token for exports
      const dlTokenMatch = path.match(/^\/api\/books\/([^/]+)\/export\/(csv|json|pdf|qbo|ofx)\/token$/);
      if (dlTokenMatch && method === 'POST') {
        const subCheck = await requireSubscription(env.DB, userId, env.SUBSCRIPTION_ENFORCEMENT, env.LICENSING_URL);
        if (subCheck) return addCors(subCheck);
        const [, dlBookId, dlFormat] = dlTokenMatch;
        // Verify the user has access to this book before generating a token (M-3)
        if (!await canAccessBook(env.DB, userId, dlBookId)) {
          return addCors(error('Access denied', 403));
        }
        const expires = Math.floor(Date.now() / 1000) + 300; // 5 minutes
        const encoder = new TextEncoder();
        // Use derived key instead of JWT_SECRET directly (H-3)
        const key = await deriveDownloadKey(env.JWT_SECRET);
        const message = `/api/books/${dlBookId}/export/${dlFormat}:${userId}:${expires}`;
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
        const token = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        return addCors(json({ url: `/api/books/${dlBookId}/export/${dlFormat}?dl_token=${token}&expires=${expires}&uid=${userId}` }));
      }

      // Export routes (authenticated via header)
      const exportMatch = path.match(/^\/api\/books\/([^/]+)\/export\/(csv|json|pdf|qbo|ofx)$/);
      if (exportMatch && method === 'GET') {
        return paid(() => exportBook(request, env, userId, exportMatch[1], exportMatch[2] as ExportFormat));
      }

      // Income integrations (paid)

      if (path === '/api/integrations' && method === 'GET') {
        return paid(() => listIntegrations(request, env, userId));
      }
      if (path === '/api/integrations' && method === 'POST') {
        return paid(() => upsertIntegration(request, env, userId));
      }
      const integrationMatch = path.match(/^\/api\/integrations\/([^/]+)$/);
      if (integrationMatch && method === 'DELETE') {
        return paid(() => deleteIntegration(request, env, userId, integrationMatch[1]));
      }
      const syncMatch = path.match(/^\/api\/integrations\/([^/]+)\/sync$/);
      if (syncMatch && method === 'POST') {
        return paid(() => syncIntegration(request, env, userId, syncMatch[1]));
      }

      // Income transactions (paid)
      if (path === '/api/income' && method === 'GET') {
        return paid(() => listIncomeTransactions(request, env, userId));
      }
      if (path === '/api/income/summary' && method === 'GET') {
        return paid(() => getIncomeSummary(request, env, userId));
      }

      // LED-33/34/36: revenue lifecycle — payouts CRUD + dashboard tiles.
      if (path === '/api/income/dashboard' && method === 'GET') {
        return paid(() => getIncomeDashboard(request, env, userId));
      }
      if (path === '/api/payouts' && method === 'GET') {
        return paid(() => listPayouts(request, env, userId));
      }
      const payoutMarkMatch = path.match(/^\/api\/payouts\/([^/]+)\/mark-received$/);
      if (payoutMarkMatch && method === 'POST') {
        return paid(() => markPayoutReceived(request, env, userId, payoutMarkMatch[1]));
      }

      // LED-39: admin/observability — manual reconcile, USD backfill, cron audit log.
      if (path === '/api/admin/reconcile' && method === 'POST') {
        return paid(() => triggerReconcile(request, env, userId));
      }
      if (path === '/api/admin/backfill-usd' && method === 'POST') {
        return paid(() => backfillUsd(request, env, userId));
      }
      if (path === '/api/admin/backfill-fees' && method === 'POST') {
        return paid(() => backfillFees(request, env, userId));
      }
      if (path === '/api/admin/cron-runs' && method === 'GET') {
        return paid(() => listCronRuns(request, env, userId));
      }

      // Subscriptions (paid)
      if (path === '/api/subscriptions' && method === 'GET') {
        return paid(() => listSubscriptions(request, env, userId));
      }
      if (path === '/api/subscriptions/summary' && method === 'GET') {
        return paid(() => getSubscriptionSummary(request, env, userId));
      }
      if (path === '/api/subscriptions/forecast' && method === 'GET') {
        return paid(() => getSubscriptionForecast(request, env, userId));
      }
      const syncSubsMatch = path.match(/^\/api\/integrations\/([^/]+)\/sync-subscriptions$/);
      if (syncSubsMatch && method === 'POST') {
        return paid(() => syncSubscriptions(request, env, userId, syncSubsMatch[1]));
      }

      // Budget status (must be before single budget route so "status" isn't treated as an ID)
      const budgetStatusMatch = path.match(/^\/api\/books\/([^/]+)\/budgets\/status$/);
      if (budgetStatusMatch && method === 'GET') {
        return paid(() => getBudgetStatus(request, env, userId, budgetStatusMatch[1]));
      }

      // Budget routes (paid)
      const budgetsMatch = path.match(/^\/api\/books\/([^/]+)\/budgets$/);
      if (budgetsMatch) {
        const bookId = budgetsMatch[1];
        if (method === 'GET') return paid(() => listBudgets(request, env, userId, bookId));
        if (method === 'POST') return paid(() => createBudget(request, env, userId, bookId));
      }

      const budgetMatch = path.match(/^\/api\/books\/([^/]+)\/budgets\/([^/]+)$/);
      if (budgetMatch) {
        const [, bookId, budgetId] = budgetMatch;
        if (method === 'PUT' || method === 'PATCH') return paid(() => updateBudget(request, env, userId, bookId, budgetId));
        if (method === 'DELETE') return paid(() => deleteBudget(request, env, userId, bookId, budgetId));
      }

      // Expense report routes (paid)
      const reportExportMatch = path.match(/^\/api\/books\/([^/]+)\/reports\/([^/]+)\/export\/(csv|pdf)$/);
      if (reportExportMatch && method === 'GET') {
        const [, bookId, reportId, format] = reportExportMatch;
        return paid(() => exportReport(request, env, userId, bookId, reportId, format as ExportFormat));
      }

      const reportItemsMatch = path.match(/^\/api\/books\/([^/]+)\/reports\/([^/]+)\/items$/);
      if (reportItemsMatch && method === 'POST') {
        return paid(() => addReportItems(request, env, userId, reportItemsMatch[1], reportItemsMatch[2]));
      }

      const reportItemMatch = path.match(/^\/api\/books\/([^/]+)\/reports\/([^/]+)\/items\/([^/]+)$/);
      if (reportItemMatch && method === 'DELETE') {
        const [, bookId, reportId, receiptId] = reportItemMatch;
        return paid(() => removeReportItem(request, env, userId, bookId, reportId, receiptId));
      }

      const reportsMatch = path.match(/^\/api\/books\/([^/]+)\/reports$/);
      if (reportsMatch) {
        const bookId = reportsMatch[1];
        if (method === 'GET') return paid(() => listReports(request, env, userId, bookId));
        if (method === 'POST') return paid(() => createReport(request, env, userId, bookId));
      }

      const reportMatch = path.match(/^\/api\/books\/([^/]+)\/reports\/([^/]+)$/);
      if (reportMatch) {
        const [, bookId, reportId] = reportMatch;
        if (method === 'GET') return paid(() => getReport(request, env, userId, bookId, reportId));
        if (method === 'PUT' || method === 'PATCH') return paid(() => updateReport(request, env, userId, bookId, reportId));
        if (method === 'DELETE') return paid(() => deleteReport(request, env, userId, bookId, reportId));
      }

      // Statement import + matching routes (paid)
      const stmtTxnActionMatch = path.match(/^\/api\/books\/([^/]+)\/statements\/([^/]+)\/transactions\/([^/]+)\/(match|unmatch|ignore|create-receipt)$/);
      if (stmtTxnActionMatch && method === 'POST') {
        const [, bookId, stmtId, txnId, action] = stmtTxnActionMatch;
        if (action === 'match') return paid(() => matchStatementTransaction(request, env, userId, bookId, stmtId, txnId));
        if (action === 'unmatch') return paid(() => unmatchStatementTransaction(request, env, userId, bookId, stmtId, txnId));
        if (action === 'ignore') return paid(() => ignoreStatementTransaction(request, env, userId, bookId, stmtId, txnId));
        return paid(() => createReceiptFromTransaction(request, env, userId, bookId, stmtId, txnId));
      }

      const stmtUploadMatch = path.match(/^\/api\/books\/([^/]+)\/statements\/upload$/);
      if (stmtUploadMatch && method === 'POST') {
        return paid(() => uploadStatement(request, env, userId, stmtUploadMatch[1]));
      }

      const stmtsMatch = path.match(/^\/api\/books\/([^/]+)\/statements$/);
      if (stmtsMatch && method === 'GET') {
        return paid(() => listStatements(request, env, userId, stmtsMatch[1]));
      }

      const stmtMatch = path.match(/^\/api\/books\/([^/]+)\/statements\/([^/]+)$/);
      if (stmtMatch) {
        const [, bookId, stmtId] = stmtMatch;
        if (method === 'GET') return paid(() => getStatement(request, env, userId, bookId, stmtId));
        if (method === 'DELETE') return paid(() => deleteStatement(request, env, userId, bookId, stmtId));
      }

      // Recurring expense routes (paid)
      const recurringExpensesMatch = path.match(/^\/api\/books\/([^/]+)\/recurring-expenses$/);
      if (recurringExpensesMatch) {
        const bookId = recurringExpensesMatch[1];
        if (method === 'GET') return paid(() => listRecurringExpenses(request, env, userId, bookId));
        if (method === 'POST') return paid(() => createRecurringExpense(request, env, userId, bookId));
      }

      const recurringExpenseMatch = path.match(/^\/api\/books\/([^/]+)\/recurring-expenses\/([^/]+)$/);
      if (recurringExpenseMatch) {
        const [, bookId, expenseId] = recurringExpenseMatch;
        if (method === 'PUT' || method === 'PATCH') return paid(() => updateRecurringExpense(request, env, userId, bookId, expenseId));
        if (method === 'DELETE') return paid(() => deleteRecurringExpense(request, env, userId, bookId, expenseId));
      }

      // Tax routes (paid, user-scoped)
      if (path === '/api/tax-categories' && method === 'GET') {
        return paid(() => getTaxCategories(request, env, userId));
      }
      if (path === '/api/tax-settings' && method === 'GET') {
        return paid(() => getTaxSettings(request, env, userId));
      }
      if (path === '/api/tax-settings' && method === 'PUT') {
        return paid(() => updateTaxSettings(request, env, userId));
      }

      // Tax routes (paid, book-scoped)
      const taxSummaryMatch = path.match(/^\/api\/books\/([^/]+)\/tax-summary$/);
      if (taxSummaryMatch && method === 'GET') {
        return paid(() => getTaxSummary(request, env, userId, taxSummaryMatch[1]));
      }

      const taxEstimatesMatch = path.match(/^\/api\/books\/([^/]+)\/tax-estimates$/);
      if (taxEstimatesMatch && method === 'GET') {
        return paid(() => getTaxEstimates(request, env, userId, taxEstimatesMatch[1]));
      }

      // P&L report (paid)
      const pnlMatch = path.match(/^\/api\/books\/([^/]+)\/pnl$/);
      if (pnlMatch && method === 'GET') {
        return paid(() => getProfitAndLoss(request, env, userId, pnlMatch[1]));
      }

      return addCors(error('Not found', 404));
    } catch (err: any) {
      console.error('Unhandled error:', err);
      return addCors(error('Internal server error', 500));
    }
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleInboundEmail(message as any, env);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // The 10-minute cron only runs the stuck-receipt cleanup so a workflow that
    // failed to write its terminal status is visible to users within ~25 minutes
    // (15-min staleness window + cron cadence) instead of waiting for the daily sync.
    if (event.cron === '*/10 * * * *') {
      ctx.waitUntil(cleanupStuckReceipts(env));
      return;
    }
    // LED-34: monthly reconciliation — settle prior month's pending income
    // and create predicted payouts. Runs at 07:00 UTC on day 1 of each
    // calendar month (an hour after the daily-sync window).
    // LED-39: wrap in cron_runs audit so silent failures surface within hours.
    if (event.cron === '0 7 1 * *') {
      const { reconcileAllUsers } = await import('./services/reconciliation');
      const runId = generateId('cron');
      const startedAt = new Date();
      ctx.waitUntil((async () => {
        try {
          await env.DB.prepare(
            `INSERT INTO cron_runs (id, cron_name, cron_schedule, trigger, started_at, status)
             VALUES (?, 'reconcile_all_users', '0 7 1 * *', 'cron', ?, 'running')`
          ).bind(runId, startedAt.toISOString()).run();
          const summary = await reconcileAllUsers(env);
          await env.DB.prepare(
            `UPDATE cron_runs
             SET finished_at = datetime('now'),
                 duration_ms = ?, status = 'success',
                 rows_settled = ?, payouts_created = ?, users_processed = ?
             WHERE id = ?`
          ).bind(
            Date.now() - startedAt.getTime(),
            summary.rowsSettled, summary.payoutsCreated, summary.usersProcessed,
            runId,
          ).run();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[cron monthly] reconcile failed:', e);
          await env.DB.prepare(
            `UPDATE cron_runs
             SET finished_at = datetime('now'),
                 duration_ms = ?, status = 'error', error_message = ?
             WHERE id = ?`
          ).bind(Date.now() - startedAt.getTime(), msg.slice(0, 1000), runId).run();
        }
      })());
      return;
    }
    // Daily 06:00 UTC: full sync of integrations, recurring expenses,
    // cleanup pass, AND payout maintenance (LED-38): pull Apple finance
    // reports + auto-mark overdue predicted payouts as paid.
    ctx.waitUntil((async () => {
      await Promise.all([
        syncAllIntegrations(env),
        advanceRecurringExpenses(env),
        cleanupStuckReceipts(env),
      ]);
      try {
        const { autoMarkOverduePayouts } = await import('./services/reconciliation');
        const { syncAppleFinanceReports } = await import('./services/integrations/apple-finance-reports');
        const { decryptValue } = await import('./utils/crypto');

        // Daily Apple finance-report scan (sub-threshold months 404; that's expected).
        const apple = await env.DB.prepare(
          `SELECT user_id, id AS integration_id, credentials FROM integrations
           WHERE is_active = 1 AND provider = 'apple_app_store'`
        ).all<{ user_id: string; integration_id: string; credentials: string }>();
        for (const row of apple.results) {
          try {
            const decrypted = await decryptValue(row.credentials, env.JWT_SECRET, row.user_id);
            const creds = JSON.parse(decrypted);
            await syncAppleFinanceReports(env, row.user_id, row.integration_id, creds);
          } catch (e) {
            console.error('[cron daily] finance-reports failed:', e);
          }
        }
        // LED-39: Google Play earnings reports (real per-transaction fees).
        const { syncGooglePlayEarnings } = await import('./services/integrations/google-play-earnings');
        const gp = await env.DB.prepare(
          `SELECT user_id, id AS integration_id, credentials FROM integrations
           WHERE is_active = 1 AND provider = 'google_play'`
        ).all<{ user_id: string; integration_id: string; credentials: string }>();
        for (const row of gp.results) {
          try {
            const decrypted = await decryptValue(row.credentials, env.JWT_SECRET, row.user_id);
            const creds = JSON.parse(decrypted);
            await syncGooglePlayEarnings(env, row.user_id, row.integration_id, creds);
          } catch (e) {
            console.error('[cron daily] gp earnings failed:', e);
          }
        }
        const marked = await autoMarkOverduePayouts(env);
        if (marked > 0) console.log(`[cron daily] auto-marked ${marked} overdue payouts paid`);
      } catch (e) {
        console.error('[cron daily] payout maintenance failed:', e);
      }
    })());
  },
};

export default worker;
