import { Env, ExportFormat } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { canAccessBook } from '../middleware/auth';
import { renderReceiptsExport, ReceiptRow } from '../services/export';

/**
 * Expense reports — user-selected bundles of receipts handed to a business
 * for reimbursement or invoicing. See docs/expense-reports-spec.md.
 *
 * Lifecycle: draft <-> submitted -> reimbursed. Items may only be mutated
 * while the report is a draft. Totals are computed from joined receipts at
 * read time, grouped per currency (no cross-currency conversion).
 */

const VALID_STATUSES = ['draft', 'submitted', 'reimbursed'] as const;

// status -> statuses it may transition to
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted'],
  submitted: ['draft', 'reimbursed'],
  reimbursed: ['submitted'], // undo path for a mistaken "reimbursed" tap
};

const MAX_RECEIPTS_PER_REPORT = 500;
const MAX_TITLE_LENGTH = 200;

interface ReportRow {
  id: string;
  book_id: string;
  user_id: string;
  title: string;
  notes: string | null;
  status: string;
  submitted_at: string | null;
  reimbursed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CurrencyTotal {
  currency: string;
  total: number;
}

export async function listReports(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const reports = await env.DB.prepare(
    `SELECT er.*,
       (SELECT COUNT(*) FROM expense_report_items i WHERE i.report_id = er.id) AS item_count
     FROM expense_reports er
     WHERE er.book_id = ?
     ORDER BY er.created_at DESC`
  ).bind(bookId).all<ReportRow & { item_count: number }>();

  // Per-currency totals for every report in the book, merged in below.
  const totals = await env.DB.prepare(
    `SELECT i.report_id, rc.currency, SUM(rc.amount) AS total
     FROM expense_report_items i
     JOIN receipts rc ON rc.id = i.receipt_id
     JOIN expense_reports er ON er.id = i.report_id
     WHERE er.book_id = ?
     GROUP BY i.report_id, rc.currency`
  ).bind(bookId).all<{ report_id: string; currency: string; total: number }>();

  const totalsByReport = new Map<string, CurrencyTotal[]>();
  for (const t of totals.results) {
    const list = totalsByReport.get(t.report_id) || [];
    list.push({ currency: t.currency, total: t.total || 0 });
    totalsByReport.set(t.report_id, list);
  }

  return success(reports.results.map(r => ({
    ...r,
    totals: totalsByReport.get(r.id) || [],
  })));
}

export async function createReport(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const body = await request.json<{ title?: string; notes?: string; receipt_ids?: string[] }>();

  const title = body.title?.trim();
  if (!title) return error('Title is required');
  if (title.length > MAX_TITLE_LENGTH) return error(`Title must be at most ${MAX_TITLE_LENGTH} characters`);

  const receiptIds = body.receipt_ids || [];
  if (!Array.isArray(receiptIds) || receiptIds.some(id => typeof id !== 'string')) {
    return error('receipt_ids must be an array of receipt IDs');
  }
  const invalid = await findInvalidReceiptIds(env, bookId, receiptIds);
  if (invalid) return invalid;

  const id = generateId('rpt');
  const statements = [
    env.DB.prepare(
      'INSERT INTO expense_reports (id, book_id, user_id, title, notes) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, bookId, userId, title, body.notes?.trim() || null),
    ...dedupe(receiptIds).map(rid =>
      env.DB.prepare('INSERT INTO expense_report_items (report_id, receipt_id) VALUES (?, ?)').bind(id, rid)
    ),
  ];
  await env.DB.batch(statements);

  return getReportPayload(env, bookId, id);
}

export async function getReport(request: Request, env: Env, userId: string, bookId: string, reportId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }
  return getReportPayload(env, bookId, reportId);
}

export async function updateReport(request: Request, env: Env, userId: string, bookId: string, reportId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const existing = await env.DB.prepare(
    'SELECT * FROM expense_reports WHERE id = ? AND book_id = ?'
  ).bind(reportId, bookId).first<ReportRow>();
  if (!existing) return error('Report not found', 404);

  const body = await request.json<{ title?: string; notes?: string; status?: string }>();

  let title = existing.title;
  if (body.title !== undefined) {
    const trimmed = body.title.trim();
    if (!trimmed) return error('Title cannot be empty');
    if (trimmed.length > MAX_TITLE_LENGTH) return error(`Title must be at most ${MAX_TITLE_LENGTH} characters`);
    title = trimmed;
  }

  const notes = body.notes !== undefined ? (body.notes.trim() || null) : existing.notes;

  let status = existing.status;
  let submittedAt = existing.submitted_at;
  let reimbursedAt = existing.reimbursed_at;

  if (body.status !== undefined && body.status !== existing.status) {
    if (!VALID_STATUSES.includes(body.status as any)) {
      return error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    if (!STATUS_TRANSITIONS[existing.status]?.includes(body.status)) {
      return error(`Cannot move a ${existing.status} report to ${body.status}`);
    }
    status = body.status;
    if (status === 'draft') {
      submittedAt = null;
      reimbursedAt = null;
    } else if (status === 'submitted') {
      submittedAt = submittedAt || new Date().toISOString();
      reimbursedAt = null;
    } else if (status === 'reimbursed') {
      reimbursedAt = new Date().toISOString();
    }
  }

  await env.DB.prepare(
    `UPDATE expense_reports
     SET title = ?, notes = ?, status = ?, submitted_at = ?, reimbursed_at = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(title, notes, status, submittedAt, reimbursedAt, reportId).run();

  return getReportPayload(env, bookId, reportId);
}

export async function deleteReport(request: Request, env: Env, userId: string, bookId: string, reportId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM expense_reports WHERE id = ? AND book_id = ?'
  ).bind(reportId, bookId).first();
  if (!existing) return error('Report not found', 404);

  // Delete items explicitly rather than relying on FK cascade behavior.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM expense_report_items WHERE report_id = ?').bind(reportId),
    env.DB.prepare('DELETE FROM expense_reports WHERE id = ?').bind(reportId),
  ]);

  return success(null, 'Report deleted');
}

export async function addReportItems(request: Request, env: Env, userId: string, bookId: string, reportId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const report = await env.DB.prepare(
    'SELECT status FROM expense_reports WHERE id = ? AND book_id = ?'
  ).bind(reportId, bookId).first<{ status: string }>();
  if (!report) return error('Report not found', 404);
  if (report.status !== 'draft') {
    return error('Receipts can only be added to a draft report', 409);
  }

  const body = await request.json<{ receipt_ids?: string[] }>();
  const receiptIds = dedupe(body.receipt_ids || []);
  if (!receiptIds.length) return error('receipt_ids is required');
  if (receiptIds.some(id => typeof id !== 'string')) {
    return error('receipt_ids must be an array of receipt IDs');
  }

  const invalid = await findInvalidReceiptIds(env, bookId, receiptIds);
  if (invalid) return invalid;

  const existingCount = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM expense_report_items WHERE report_id = ?'
  ).bind(reportId).first<{ n: number }>();
  if ((existingCount?.n || 0) + receiptIds.length > MAX_RECEIPTS_PER_REPORT) {
    return error(`A report can contain at most ${MAX_RECEIPTS_PER_REPORT} receipts`);
  }

  await env.DB.batch(receiptIds.map(rid =>
    env.DB.prepare('INSERT OR IGNORE INTO expense_report_items (report_id, receipt_id) VALUES (?, ?)').bind(reportId, rid)
  ));

  return getReportPayload(env, bookId, reportId);
}

export async function removeReportItem(request: Request, env: Env, userId: string, bookId: string, reportId: string, receiptId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const report = await env.DB.prepare(
    'SELECT status FROM expense_reports WHERE id = ? AND book_id = ?'
  ).bind(reportId, bookId).first<{ status: string }>();
  if (!report) return error('Report not found', 404);
  if (report.status !== 'draft') {
    return error('Receipts can only be removed from a draft report', 409);
  }

  const result = await env.DB.prepare(
    'DELETE FROM expense_report_items WHERE report_id = ? AND receipt_id = ?'
  ).bind(reportId, receiptId).run();
  if (!result.meta.changes) return error('Receipt is not on this report', 404);

  return getReportPayload(env, bookId, reportId);
}

export async function exportReport(request: Request, env: Env, userId: string, bookId: string, reportId: string, format: ExportFormat): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const report = await env.DB.prepare(
    'SELECT * FROM expense_reports WHERE id = ? AND book_id = ?'
  ).bind(reportId, bookId).first<ReportRow>();
  if (!report) return error('Report not found', 404);

  const receipts = await env.DB.prepare(
    `SELECT rc.* FROM receipts rc
     JOIN expense_report_items i ON i.receipt_id = rc.id
     WHERE i.report_id = ?
     ORDER BY rc.date DESC`
  ).bind(reportId).all<ReceiptRow>();

  const book = await env.DB.prepare('SELECT name, currency FROM books WHERE id = ?').bind(bookId).first<{ name: string; currency: string }>();

  return renderReceiptsExport(
    receipts.results,
    sanitizeExportName(report.title),
    book?.currency || 'USD',
    format,
    { title: report.title, status: report.status, notes: report.notes },
  );
}

// --- helpers ---

/** Fetch a report with its receipts and per-currency totals, as a success Response. */
async function getReportPayload(env: Env, bookId: string, reportId: string): Promise<Response> {
  const report = await env.DB.prepare(
    'SELECT * FROM expense_reports WHERE id = ? AND book_id = ?'
  ).bind(reportId, bookId).first<ReportRow>();
  if (!report) return error('Report not found', 404);

  const receipts = await env.DB.prepare(
    `SELECT rc.* FROM receipts rc
     JOIN expense_report_items i ON i.receipt_id = rc.id
     WHERE i.report_id = ?
     ORDER BY rc.date DESC`
  ).bind(reportId).all<ReceiptRow>();

  const totalsMap = new Map<string, number>();
  for (const r of receipts.results) {
    totalsMap.set(r.currency, (totalsMap.get(r.currency) || 0) + (r.amount || 0));
  }
  const totals: CurrencyTotal[] = [...totalsMap.entries()].map(([currency, total]) => ({ currency, total }));

  return success({
    ...report,
    item_count: receipts.results.length,
    totals,
    receipts: receipts.results,
  });
}

/**
 * Validate that every id is a completed receipt in this book. Returns an
 * error Response naming offenders, or null when all are valid.
 */
async function findInvalidReceiptIds(env: Env, bookId: string, receiptIds: string[]): Promise<Response | null> {
  const ids = dedupe(receiptIds);
  if (!ids.length) return null;
  if (ids.length > MAX_RECEIPTS_PER_REPORT) {
    return error(`A report can contain at most ${MAX_RECEIPTS_PER_REPORT} receipts`);
  }

  const found = new Set<string>();
  // Chunk to stay well under D1's bound-parameter limit.
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await env.DB.prepare(
      `SELECT id FROM receipts WHERE book_id = ? AND status = 'completed' AND id IN (${placeholders})`
    ).bind(bookId, ...chunk).all<{ id: string }>();
    for (const row of rows.results) found.add(row.id);
  }

  const missing = ids.filter(id => !found.has(id));
  if (missing.length) {
    return error(`Receipts not found in this book (or not completed): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`);
  }
  return null;
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function sanitizeExportName(name: string): string {
  return name.replace(/["\r\n\\/:<>|?*]/g, '_').replace(/[^\x20-\x7E]/g, '_').slice(0, 100) || 'report';
}
