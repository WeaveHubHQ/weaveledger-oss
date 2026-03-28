import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { canAccessBook } from '../middleware/auth';

const VALID_PERIODS = ['monthly', 'quarterly', 'yearly'];

export async function listBudgets(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const results = await env.DB.prepare(
    'SELECT * FROM budgets WHERE book_id = ? ORDER BY category ASC'
  ).bind(bookId).all();

  return success(results.results);
}

export async function createBudget(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const body = await request.json<{ category: string; amount: number; period?: string; start_date?: string }>();

  if (!body.category || typeof body.category !== 'string' || !body.category.trim()) {
    return error('Category is required');
  }
  if (typeof body.amount !== 'number' || body.amount <= 0) {
    return error('Amount must be a positive number (in cents)');
  }
  if (!Number.isInteger(body.amount)) {
    return error('Amount must be an integer (cents)');
  }

  const period = body.period || 'monthly';
  if (!VALID_PERIODS.includes(period)) {
    return error(`Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}`);
  }

  // Check for duplicate
  const existing = await env.DB.prepare(
    'SELECT id FROM budgets WHERE book_id = ? AND category = ? AND period = ?'
  ).bind(bookId, body.category.trim(), period).first();
  if (existing) {
    return error('A budget already exists for this category and period');
  }

  const id = generateId('bgt');
  await env.DB.prepare(
    'INSERT INTO budgets (id, user_id, book_id, category, amount, period, start_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, bookId, body.category.trim(), body.amount, period, body.start_date || null).run();

  const budget = await env.DB.prepare('SELECT * FROM budgets WHERE id = ?').bind(id).first();
  return success(budget);
}

export async function updateBudget(request: Request, env: Env, userId: string, bookId: string, budgetId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const existing = await env.DB.prepare(
    'SELECT * FROM budgets WHERE id = ? AND book_id = ?'
  ).bind(budgetId, bookId).first();
  if (!existing) return error('Budget not found', 404);

  const body = await request.json<{ category?: string; amount?: number; period?: string; start_date?: string }>();

  if (body.amount !== undefined) {
    if (typeof body.amount !== 'number' || body.amount <= 0) {
      return error('Amount must be a positive number (in cents)');
    }
    if (!Number.isInteger(body.amount)) {
      return error('Amount must be an integer (cents)');
    }
  }

  if (body.period !== undefined && !VALID_PERIODS.includes(body.period)) {
    return error(`Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}`);
  }

  const category = body.category?.trim() || (existing as any).category;
  const amount = body.amount ?? (existing as any).amount;
  const period = body.period || (existing as any).period;
  const startDate = body.start_date !== undefined ? body.start_date : (existing as any).start_date;

  await env.DB.prepare(
    "UPDATE budgets SET category = ?, amount = ?, period = ?, start_date = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(category, amount, period, startDate, budgetId).run();

  const updated = await env.DB.prepare('SELECT * FROM budgets WHERE id = ?').bind(budgetId).first();
  return success(updated);
}

export async function deleteBudget(request: Request, env: Env, userId: string, bookId: string, budgetId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const result = await env.DB.prepare(
    'DELETE FROM budgets WHERE id = ? AND book_id = ?'
  ).bind(budgetId, bookId).run();

  if (!result.meta.changes) return error('Budget not found', 404);
  return success(null, 'Budget deleted');
}

function getPeriodDates(period: string, now: Date): { start: string; end: string } {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  if (period === 'monthly') {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0); // last day of current month
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }

  if (period === 'quarterly') {
    const quarter = Math.floor(month / 3);
    const startMonth = quarter * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }

  // yearly
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

export async function getBudgetStatus(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const budgets = await env.DB.prepare(
    'SELECT * FROM budgets WHERE book_id = ? ORDER BY category ASC'
  ).bind(bookId).all();

  // Allow viewing historical periods via ?year=2026&month=1
  const url = new URL(request.url);
  const yearParam = url.searchParams.get('year');
  const monthParam = url.searchParams.get('month');
  let targetDate = new Date();
  if (yearParam && monthParam) {
    targetDate = new Date(parseInt(yearParam), parseInt(monthParam) - 1, 15);
  } else if (yearParam) {
    targetDate = new Date(parseInt(yearParam), 0, 15);
  }

  const statuses = [];

  for (const budget of budgets.results as any[]) {
    const { start, end } = getPeriodDates(budget.period, targetDate);

    // Sum actual spend from receipts in this category during this period
    const spentResult = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total_spent
       FROM receipts
       WHERE book_id = ? AND category = ? AND date >= ? AND date <= ? AND status != 'failed'`
    ).bind(bookId, budget.category, start, end).first<{ total_spent: number }>();

    // amount in receipts is dollars (REAL), budget amount is cents
    const spentCents = Math.round((spentResult?.total_spent || 0) * 100);
    const remaining = budget.amount - spentCents;
    const percentUsed = budget.amount > 0 ? Math.round((spentCents / budget.amount) * 100) : 0;

    statuses.push({
      budget,
      spent: spentCents,
      remaining,
      percentUsed,
      periodStart: start,
      periodEnd: end,
    });
  }

  return success(statuses);
}
