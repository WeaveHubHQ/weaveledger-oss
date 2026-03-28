import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { canAccessBook } from '../middleware/auth';

const VALID_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];

export async function listRecurringExpenses(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const url = new URL(request.url);
  const isActive = url.searchParams.get('is_active');

  let query = 'SELECT * FROM recurring_expenses WHERE book_id = ?';
  const bindings: any[] = [bookId];

  if (isActive !== null) {
    query += ' AND is_active = ?';
    bindings.push(isActive === '1' || isActive === 'true' ? 1 : 0);
  }

  query += ' ORDER BY next_due_date ASC';

  const stmt = env.DB.prepare(query);
  const results = await stmt.bind(...bindings).all();

  return success(results.results);
}

export async function createRecurringExpense(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const body = await request.json<{
    name: string;
    amount: number;
    category?: string;
    frequency?: string;
    next_due_date: string;
    auto_create?: boolean;
    notes?: string;
  }>();

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return error('Name is required');
  }
  if (typeof body.amount !== 'number' || body.amount <= 0) {
    return error('Amount must be a positive number');
  }
  if (!body.next_due_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.next_due_date)) {
    return error('next_due_date is required in YYYY-MM-DD format');
  }

  const frequency = body.frequency || 'monthly';
  if (!VALID_FREQUENCIES.includes(frequency)) {
    return error(`Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')}`);
  }

  const id = generateId('rec');
  await env.DB.prepare(
    'INSERT INTO recurring_expenses (id, user_id, book_id, name, amount, category, frequency, next_due_date, auto_create, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, userId, bookId, body.name.trim(), body.amount,
    body.category || null, frequency, body.next_due_date,
    body.auto_create ? 1 : 0, body.notes || null
  ).run();

  const expense = await env.DB.prepare('SELECT * FROM recurring_expenses WHERE id = ?').bind(id).first();
  return success(expense);
}

export async function updateRecurringExpense(request: Request, env: Env, userId: string, bookId: string, expenseId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const existing = await env.DB.prepare(
    'SELECT * FROM recurring_expenses WHERE id = ? AND book_id = ?'
  ).bind(expenseId, bookId).first();
  if (!existing) return error('Recurring expense not found', 404);

  const body = await request.json<{
    name?: string;
    amount?: number;
    category?: string;
    frequency?: string;
    next_due_date?: string;
    auto_create?: boolean;
    notes?: string;
    is_active?: boolean;
  }>();

  if (body.amount !== undefined && (typeof body.amount !== 'number' || body.amount <= 0)) {
    return error('Amount must be a positive number');
  }
  if (body.frequency !== undefined && !VALID_FREQUENCIES.includes(body.frequency)) {
    return error(`Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')}`);
  }
  if (body.next_due_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.next_due_date)) {
    return error('next_due_date must be in YYYY-MM-DD format');
  }

  const e = existing as any;
  const name = body.name?.trim() || e.name;
  const amount = body.amount ?? e.amount;
  const category = body.category !== undefined ? (body.category || null) : e.category;
  const frequency = body.frequency || e.frequency;
  const nextDueDate = body.next_due_date || e.next_due_date;
  const autoCreate = body.auto_create !== undefined ? (body.auto_create ? 1 : 0) : e.auto_create;
  const notes = body.notes !== undefined ? (body.notes || null) : e.notes;
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : e.is_active;

  await env.DB.prepare(
    "UPDATE recurring_expenses SET name = ?, amount = ?, category = ?, frequency = ?, next_due_date = ?, auto_create = ?, notes = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(name, amount, category, frequency, nextDueDate, autoCreate, notes, isActive, expenseId).run();

  const updated = await env.DB.prepare('SELECT * FROM recurring_expenses WHERE id = ?').bind(expenseId).first();
  return success(updated);
}

export async function deleteRecurringExpense(request: Request, env: Env, userId: string, bookId: string, expenseId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const result = await env.DB.prepare(
    'DELETE FROM recurring_expenses WHERE id = ? AND book_id = ?'
  ).bind(expenseId, bookId).run();

  if (!result.meta.changes) return error('Recurring expense not found', 404);
  return success(null, 'Recurring expense deleted');
}

function advanceDate(dateStr: string, frequency: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    default: // monthly
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

export async function advanceRecurringExpenses(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const overdue = await env.DB.prepare(
    'SELECT id, next_due_date, frequency FROM recurring_expenses WHERE is_active = 1 AND next_due_date < ?'
  ).bind(today).all();

  for (const row of overdue.results as any[]) {
    // Advance until the next_due_date is today or in the future
    let next = row.next_due_date;
    while (next < today) {
      next = advanceDate(next, row.frequency);
    }

    await env.DB.prepare(
      "UPDATE recurring_expenses SET next_due_date = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(next, row.id).run();
  }
}
