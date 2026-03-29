import { Env } from './types';
import { authenticate, authenticateDownload, checkRateLimit, canAccessBook, requireSubscription } from './middleware/auth';
import { deriveDownloadKey } from './utils/crypto';
import { register, login, changePassword, getProfile, updatePreferences, getUserApiKey, mfaSetup, mfaEnable, mfaDisable, addLinkedEmail, removeLinkedEmail, listLinkedEmails, forgotPassword, resetPassword, refreshAuth } from './routes/auth';
import { listBooks, createBook, getBook, updateBook, deleteBook, shareBook, revokeShare, listInvitations, revokeInvitation } from './routes/books';
import { listReceipts, createReceipt, getReceipt, updateReceipt, deleteReceipt, uploadReceiptImage, getReceiptImage, getReceiptAttachment, retryReceipt, getBookSummary } from './routes/receipts';
import { exportBook } from './services/export';
import { listIntegrations, upsertIntegration, deleteIntegration, syncIntegration, syncAllIntegrations, listIncomeTransactions, getIncomeSummary } from './routes/income';
import { listSubscriptions, getSubscriptionSummary, getSubscriptionForecast, syncSubscriptions, addGooglePlaySubscription, handleGooglePlayWebhook } from './routes/subscriptions';
import { verifyAppSubscription, getAppSubscriptionStatus, restoreAppSubscription, handleAppleNotificationWebhook } from './routes/app-subscription';
import { listBudgets, createBudget, updateBudget, deleteBudget, getBudgetStatus } from './routes/budgets';
import { listRecurringExpenses, createRecurringExpense, updateRecurringExpense, deleteRecurringExpense, advanceRecurringExpenses } from './routes/recurring-expenses';
import { getTaxCategories, getTaxSettings, updateTaxSettings, getTaxSummary, getTaxEstimates } from './routes/tax';
import { getProfitAndLoss } from './routes/pnl';
import { handleInboundEmail } from './services/email-handler';
import { error, json } from './utils/response';
import { landingPage } from './utils/landing';
import { termsOfServicePage, privacyPolicyPage } from './utils/legal';
import { ExportFormat } from './types';

export { ReceiptProcessorWorkflow } from './workflows/receipt-processor';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      // Public routes (rate limited)
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
      if (path === '/api/health') {
        return addCors(json({ status: 'ok', version: '1.3.0' }));
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

      // Linked email routes
      if (path === '/api/auth/emails' && method === 'GET') {
        return addCors(await listLinkedEmails(request, env, userId));
      }
      if (path === '/api/auth/emails' && method === 'POST') {
        return addCors(await addLinkedEmail(request, env, userId));
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
      const receiptsMatch = path.match(/^\/api\/books\/([^/]+)\/receipts$/);
      if (receiptsMatch) {
        const bookId = receiptsMatch[1];
        if (method === 'GET') return addCors(await listReceipts(request, env, userId, bookId));
        if (method === 'POST') return paid(() => createReceipt(request, env, userId, bookId));
      }

      // Receipt image upload
      const uploadMatch = path.match(/^\/api\/books\/([^/]+)\/receipts\/upload$/);
      if (uploadMatch && method === 'POST') {
        return paid(() => uploadReceiptImage(request, env, userId, uploadMatch[1]));
      }

      // Single receipt routes
      const receiptMatch = path.match(/^\/api\/books\/([^/]+)\/receipts\/([^/]+)$/);
      if (receiptMatch) {
        const [, bookId, receiptId] = receiptMatch;
        if (method === 'GET') return addCors(await getReceipt(request, env, userId, bookId, receiptId));
        if (method === 'PUT' || method === 'PATCH') return paid(() => updateReceipt(request, env, userId, bookId, receiptId));
        if (method === 'DELETE') return paid(() => deleteReceipt(request, env, userId, bookId, receiptId));
      }

      // Receipt retry
      const retryMatch = path.match(/^\/api\/books\/([^/]+)\/receipts\/([^/]+)\/retry$/);
      if (retryMatch && method === 'POST') {
        return paid(() => retryReceipt(request, env, userId, retryMatch[1], retryMatch[2]));
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
    ctx.waitUntil(Promise.all([
      syncAllIntegrations(env),
      advanceRecurringExpenses(env),
    ]));
  },
};
