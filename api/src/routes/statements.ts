import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { canAccessBook } from '../middleware/auth';
import {
  sniffFormat, parseStatement, StatementParseError,
  matchTransactions, loadCandidateReceipts,
} from '../services/statement-import';

/**
 * Statement upload + receipt matching. See docs/statement-matching-spec.md.
 *
 * Transactions land as: unmatched | suggested (matcher found a likely
 * receipt) | confirmed (user accepted) | ignored (user dismissed, e.g.
 * personal spending on a business card). Unmatched transactions can be
 * converted into manual receipts so the ledger stays complete.
 */

const MAX_STATEMENT_BYTES = 2 * 1024 * 1024;
const MAX_TRANSACTIONS = 2000;

export async function uploadStatement(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  let text: string;
  let filename: string | null = null;
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const raw = form.get('file');
    if (!raw || typeof raw === 'string') return error('Missing "file" field in form data');
    // workers-types' FormDataEntryValue narrows poorly here; it's a File
    const file = raw as unknown as { size: number; name?: string; text(): Promise<string> };
    if (file.size > MAX_STATEMENT_BYTES) return error('Statement file too large (max 2 MB)');
    filename = file.name || null;
    text = await file.text();
  } else {
    text = await request.text();
    if (text.length > MAX_STATEMENT_BYTES) return error('Statement file too large (max 2 MB)');
  }
  if (!text.trim()) return error('Empty statement file');

  const url = new URL(request.url);
  const formatParam = url.searchParams.get('format');
  const format = formatParam === 'ofx' || formatParam === 'csv' ? formatParam : sniffFormat(text);
  if (!format) return error('Could not detect statement format. Upload an OFX or CSV file (PDF statements are not yet supported).');

  let parsed;
  try {
    parsed = parseStatement(text, format);
  } catch (e) {
    if (e instanceof StatementParseError) return error(e.message);
    throw e;
  }
  if (!parsed.transactions.length) {
    return error('No debit transactions found in the statement. Only money-out transactions are imported.');
  }
  if (parsed.transactions.length > MAX_TRANSACTIONS) {
    return error(`Statement has too many transactions (max ${MAX_TRANSACTIONS})`);
  }

  // Dedup re-imports by OFX FITID within the book
  let transactions = parsed.transactions;
  const fitids = transactions.map(t => t.fitid).filter((f): f is string => !!f);
  if (fitids.length) {
    const existing = new Set<string>();
    for (let i = 0; i < fitids.length; i += 50) {
      const chunk = fitids.slice(i, i + 50);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = await env.DB.prepare(
        `SELECT fitid FROM statement_transactions WHERE book_id = ? AND fitid IN (${placeholders})`
      ).bind(bookId, ...chunk).all<{ fitid: string }>();
      for (const r of rows.results) existing.add(r.fitid);
    }
    transactions = transactions.filter(t => !t.fitid || !existing.has(t.fitid));
    if (!transactions.length) {
      return error('All transactions in this statement were already imported (matched by FITID).', 409);
    }
  }

  const dates = transactions.map(t => t.date).sort();
  const periodStart = dates[0];
  const periodEnd = dates[dates.length - 1];

  // Match against receipts before writing, so suggestions land in the insert
  const receipts = await loadCandidateReceipts(env, bookId, periodStart, periodEnd);
  const confirmedElsewhere = await env.DB.prepare(
    `SELECT matched_receipt_id AS id FROM statement_transactions
     WHERE book_id = ? AND match_status = 'confirmed' AND matched_receipt_id IS NOT NULL`
  ).bind(bookId).all<{ id: string }>();
  const taken = new Set(confirmedElsewhere.results.map(r => r.id));
  const suggestions = matchTransactions(transactions, receipts, taken);

  const statementId = generateId('stmt');
  const statements = [
    env.DB.prepare(
      `INSERT INTO statements (id, book_id, user_id, filename, format, account_name, currency, period_start, period_end, transaction_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(statementId, bookId, userId, filename, parsed.format, parsed.accountName, parsed.currency, periodStart, periodEnd, transactions.length),
    ...transactions.map((t, i) => {
      const s = suggestions[i];
      return env.DB.prepare(
        `INSERT INTO statement_transactions
           (id, statement_id, book_id, date, description, amount, currency, fitid, match_status, matched_receipt_id, match_confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        generateId('stx'), statementId, bookId, t.date, t.description, t.amount, t.currency,
        t.fitid, s ? 'suggested' : 'unmatched', s ? s.receiptId : null, s ? s.confidence : null,
      );
    }),
  ];
  // D1 batches are capped well above this, but chunk to stay safe on big statements
  for (let i = 0; i < statements.length; i += 100) {
    await env.DB.batch(statements.slice(i, i + 100));
  }

  const suggested = suggestions.filter(Boolean).length;
  return success({
    id: statementId,
    format: parsed.format,
    period_start: periodStart,
    period_end: periodEnd,
    transaction_count: transactions.length,
    suggested_matches: suggested,
    unmatched: transactions.length - suggested,
  }, `Imported ${transactions.length} transactions, ${suggested} matched to receipts`);
}

export async function listStatements(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const rows = await env.DB.prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM statement_transactions t WHERE t.statement_id = s.id AND t.match_status = 'confirmed') AS confirmed_count,
       (SELECT COUNT(*) FROM statement_transactions t WHERE t.statement_id = s.id AND t.match_status = 'suggested') AS suggested_count,
       (SELECT COUNT(*) FROM statement_transactions t WHERE t.statement_id = s.id AND t.match_status = 'unmatched') AS unmatched_count,
       (SELECT COUNT(*) FROM statement_transactions t WHERE t.statement_id = s.id AND t.match_status = 'ignored') AS ignored_count
     FROM statements s WHERE s.book_id = ? ORDER BY s.created_at DESC`
  ).bind(bookId).all();

  return success(rows.results);
}

export async function getStatement(request: Request, env: Env, userId: string, bookId: string, statementId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const statement = await env.DB.prepare(
    'SELECT * FROM statements WHERE id = ? AND book_id = ?'
  ).bind(statementId, bookId).first();
  if (!statement) return error('Statement not found', 404);

  const transactions = await env.DB.prepare(
    `SELECT t.*, r.merchant AS receipt_merchant, r.amount AS receipt_amount, r.date AS receipt_date, r.category AS receipt_category
     FROM statement_transactions t
     LEFT JOIN receipts r ON r.id = t.matched_receipt_id
     WHERE t.statement_id = ?
     ORDER BY t.date DESC, t.id`
  ).bind(statementId).all();

  return success({ ...statement, transactions: transactions.results });
}

export async function deleteStatement(request: Request, env: Env, userId: string, bookId: string, statementId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM statements WHERE id = ? AND book_id = ?'
  ).bind(statementId, bookId).first();
  if (!existing) return error('Statement not found', 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM statement_transactions WHERE statement_id = ?').bind(statementId),
    env.DB.prepare('DELETE FROM statements WHERE id = ?').bind(statementId),
  ]);
  return success(null, 'Statement deleted (receipts are kept)');
}

/** Confirm a match — either the suggestion, or an explicit receipt_id override. */
export async function matchStatementTransaction(request: Request, env: Env, userId: string, bookId: string, statementId: string, txnId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const txn = await env.DB.prepare(
    'SELECT * FROM statement_transactions WHERE id = ? AND statement_id = ? AND book_id = ?'
  ).bind(txnId, statementId, bookId).first<{ matched_receipt_id: string | null }>();
  if (!txn) return error('Transaction not found', 404);

  const body = await request.json<{ receipt_id?: string }>().catch(() => ({} as { receipt_id?: string }));
  const receiptId = body.receipt_id || txn.matched_receipt_id;
  if (!receiptId) return error('No suggested receipt — pass receipt_id to match explicitly');

  const receipt = await env.DB.prepare(
    "SELECT id FROM receipts WHERE id = ? AND book_id = ? AND status = 'completed'"
  ).bind(receiptId, bookId).first();
  if (!receipt) return error('Receipt not found in this book (or not completed)', 404);

  await env.DB.prepare(
    `UPDATE statement_transactions
     SET match_status = 'confirmed', matched_receipt_id = ?, match_confidence = COALESCE(match_confidence, 1.0)
     WHERE id = ?`
  ).bind(receiptId, txnId).run();

  return success(null, 'Match confirmed');
}

export async function unmatchStatementTransaction(request: Request, env: Env, userId: string, bookId: string, statementId: string, txnId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const result = await env.DB.prepare(
    `UPDATE statement_transactions
     SET match_status = 'unmatched', matched_receipt_id = NULL, match_confidence = NULL
     WHERE id = ? AND statement_id = ? AND book_id = ?`
  ).bind(txnId, statementId, bookId).run();
  if (!result.meta.changes) return error('Transaction not found', 404);
  return success(null, 'Match cleared');
}

export async function ignoreStatementTransaction(request: Request, env: Env, userId: string, bookId: string, statementId: string, txnId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const result = await env.DB.prepare(
    `UPDATE statement_transactions
     SET match_status = 'ignored', matched_receipt_id = NULL, match_confidence = NULL
     WHERE id = ? AND statement_id = ? AND book_id = ?`
  ).bind(txnId, statementId, bookId).run();
  if (!result.meta.changes) return error('Transaction not found', 404);
  return success(null, 'Transaction ignored');
}

/** Create a manual receipt from an unmatched transaction and confirm the match. */
export async function createReceiptFromTransaction(request: Request, env: Env, userId: string, bookId: string, statementId: string, txnId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId, 'member'))) {
    return error('Book not found or access denied', 404);
  }

  const txn = await env.DB.prepare(
    'SELECT * FROM statement_transactions WHERE id = ? AND statement_id = ? AND book_id = ?'
  ).bind(txnId, statementId, bookId).first<{
    date: string; description: string; amount: number; currency: string; match_status: string;
  }>();
  if (!txn) return error('Transaction not found', 404);
  if (txn.match_status === 'confirmed') return error('Transaction is already matched to a receipt', 409);

  const body = await request.json<{ category?: string; merchant?: string }>().catch(() => ({} as { category?: string; merchant?: string }));
  const merchant = (body.merchant || cleanMerchant(txn.description)).slice(0, 200);

  const receiptId = generateId('rcpt');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO receipts (id, book_id, user_id, merchant, amount, currency, date, category, description, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'completed')`
    ).bind(receiptId, bookId, userId, merchant, txn.amount, txn.currency, txn.date, body.category || null, txn.description),
    env.DB.prepare(
      `UPDATE statement_transactions
       SET match_status = 'confirmed', matched_receipt_id = ?, match_confidence = 1.0
       WHERE id = ?`
    ).bind(receiptId, txnId),
  ]);

  return success({ receipt_id: receiptId }, 'Receipt created and matched');
}

/** Strip card-processor noise from a statement description for use as a merchant name. */
function cleanMerchant(description: string): string {
  return description
    .replace(/\b(POS|DEBIT|CREDIT|PURCHASE|PAYMENT|CARD \d+|CHECKCARD|SQ|TST|PAYPAL \*|PP\*)\b/gi, ' ')
    .replace(/\d{4,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || description.trim() || 'Unknown';
}
