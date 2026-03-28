import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { canAccessBook } from '../middleware/auth';

interface ReceiptFilters {
  category?: string;
  date_from?: string;
  date_to?: string;
  merchant?: string;
  min_amount?: string;
  max_amount?: string;
  status?: string;
  source?: string;
  search?: string;
  sort?: string;
  order?: string;
  page?: string;
  limit?: string;
}

export async function listReceipts(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId)) {
    return error('Access denied', 403);
  }

  const url = new URL(request.url);
  const filters: ReceiptFilters = Object.fromEntries(url.searchParams);

  let query = 'SELECT * FROM receipts WHERE book_id = ?';
  const params: (string | number)[] = [bookId];

  if (filters.category) { query += ' AND category = ?'; params.push(filters.category); }
  if (filters.date_from) { query += ' AND date >= ?'; params.push(filters.date_from); }
  if (filters.date_to) { query += ' AND date <= ?'; params.push(filters.date_to); }
  if (filters.merchant) { query += ' AND merchant LIKE ?'; params.push(`%${filters.merchant}%`); }
  if (filters.min_amount) { const v = parseFloat(filters.min_amount); if (!isNaN(v)) { query += ' AND amount >= ?'; params.push(v); } }
  if (filters.max_amount) { const v = parseFloat(filters.max_amount); if (!isNaN(v)) { query += ' AND amount <= ?'; params.push(v); } }
  if (filters.status) { query += ' AND status = ?'; params.push(filters.status); }
  if (filters.source) { query += ' AND source = ?'; params.push(filters.source); }
  if (filters.search) {
    query += ' AND (merchant LIKE ? OR description LIKE ? OR notes LIKE ?)';
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }

  // Count total for pagination
  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const countResult = await env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();

  const sortField = filters.sort || 'date';
  const sortOrder = filters.order === 'asc' ? 'ASC' : 'DESC';
  // SECURITY: allowlist prevents SQL injection — do not add user-controlled values
  const allowedSorts = ['date', 'amount', 'merchant', 'category', 'created_at'];
  if (allowedSorts.includes(sortField)) {
    query += ` ORDER BY ${sortField} ${sortOrder}`;
  } else {
    query += ` ORDER BY date ${sortOrder}`;
  }

  const limit = Math.min(parseInt(filters.limit || '50') || 50, 100);
  const page = Math.max(parseInt(filters.page || '1') || 1, 1);
  const offset = (page - 1) * limit;
  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const results = await env.DB.prepare(query).bind(...params).all();

  return success({
    receipts: results.results,
    pagination: {
      page,
      limit,
      total: countResult?.total || 0,
      pages: Math.ceil((countResult?.total || 0) / limit),
    },
  });
}

export async function createReceipt(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId, 'member')) {
    return error('Access denied', 403);
  }

  const body = await request.json<{
    merchant?: string; amount?: number; currency?: string; date?: string;
    category?: string; subcategory?: string; description?: string;
    payment_method?: string; tax_amount?: number; tip_amount?: number;
    notes?: string; source?: string;
  }>();

  const id = generateId('rcpt');
  await env.DB.prepare(
    `INSERT INTO receipts (id, book_id, user_id, merchant, amount, currency, date, category, subcategory,
     description, payment_method, tax_amount, tip_amount, notes, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`
  ).bind(
    id, bookId, userId, body.merchant ?? null, body.amount ?? null,
    body.currency ?? 'USD', body.date ?? null, body.category ?? null,
    body.subcategory ?? null, body.description ?? null, body.payment_method ?? null,
    body.tax_amount ?? null, body.tip_amount ?? null, body.notes ?? null,
    body.source ?? 'manual'
  ).run();

  const receipt = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  return success(receipt, 'Receipt created');
}

export async function getReceipt(request: Request, env: Env, userId: string, bookId: string, receiptId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId)) {
    return error('Access denied', 403);
  }

  const receipt = await env.DB.prepare('SELECT * FROM receipts WHERE id = ? AND book_id = ?').bind(receiptId, bookId).first();
  if (!receipt) return error('Receipt not found', 404);

  const lineItems = await env.DB.prepare('SELECT * FROM line_items WHERE receipt_id = ?').bind(receiptId).all();
  const tags = await env.DB.prepare(
    'SELECT t.* FROM tags t JOIN receipt_tags rt ON rt.tag_id = t.id WHERE rt.receipt_id = ?'
  ).bind(receiptId).all();

  return success({ ...receipt, line_items: lineItems.results, tags: tags.results });
}

export async function updateReceipt(request: Request, env: Env, userId: string, bookId: string, receiptId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId, 'member')) {
    return error('Access denied', 403);
  }

  const body = await request.json<Record<string, unknown>>();
  const allowedFields = ['merchant', 'amount', 'currency', 'date', 'category', 'subcategory',
    'description', 'payment_method', 'tax_amount', 'tip_amount', 'notes', 'status',
    'tax_deductible', 'tax_category'];

  // Validate enum fields
  const validStatuses = ['pending', 'processing', 'completed', 'failed'];
  if (body.status !== undefined && !validStatuses.includes(body.status as string)) {
    return error('Invalid status. Must be: pending, processing, completed, or failed.');
  }

  // Handle moving receipt to a different book
  if (body.book_id !== undefined && body.book_id !== bookId) {
    const targetBookId = body.book_id as string;
    if (!await canAccessBook(env.DB, userId, targetBookId, 'member')) {
      return error('Access denied to target book', 403);
    }
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  // Allow book_id change (move receipt)
  if (body.book_id !== undefined && body.book_id !== bookId) {
    updates.push('book_id = ?');
    values.push(body.book_id);
  }

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (updates.length === 0) return error('No fields to update');

  updates.push("updated_at = datetime('now')");
  values.push(receiptId, bookId);

  await env.DB.prepare(`UPDATE receipts SET ${updates.join(', ')} WHERE id = ? AND book_id = ?`).bind(...values).run();
  const receipt = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(receiptId).first();
  return success(receipt);
}

export async function deleteReceipt(request: Request, env: Env, userId: string, bookId: string, receiptId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId, 'member')) {
    return error('Access denied', 403);
  }

  const receipt = await env.DB.prepare('SELECT image_key FROM receipts WHERE id = ? AND book_id = ?').bind(receiptId, bookId).first<{ image_key: string | null }>();
  if (!receipt) return error('Receipt not found', 404);

  if (receipt.image_key) {
    await env.RECEIPTS_BUCKET.delete(receipt.image_key);
  }

  await env.DB.prepare('DELETE FROM receipts WHERE id = ? AND book_id = ?').bind(receiptId, bookId).run();
  return success(null, 'Receipt deleted');
}

export async function uploadReceiptImage(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId, 'member')) {
    return error('Access denied', 403);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.startsWith('image/') && !contentType.startsWith('multipart/form-data') && contentType !== 'application/pdf') {
    return error('Invalid content type. Expected image, PDF, or multipart form data.');
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

  interface UploadFile { data: ArrayBuffer; type: string; name: string }
  const files: UploadFile[] = [];

  if (contentType.startsWith('multipart/form-data')) {
    const formData = await request.formData();
    // Support both 'image' (single) and 'files' (multiple) field names
    for (const [key, value] of formData.entries()) {
      if (!(value instanceof File)) continue;
      if (!ALLOWED_TYPES.includes(value.type)) continue;
      const data = await value.arrayBuffer();
      if (data.byteLength > MAX_FILE_SIZE || data.byteLength === 0) continue;
      files.push({ data, type: value.type, name: value.name });
    }
    if (files.length === 0) return error('No valid files provided. Allowed: JPEG, PNG, WebP, HEIC, PDF (max 10MB).');
  } else {
    if (!ALLOWED_TYPES.includes(contentType)) {
      return error('Unsupported file type. Allowed: JPEG, PNG, WebP, HEIC, PDF.');
    }
    const data = await request.arrayBuffer();
    if (data.byteLength > MAX_FILE_SIZE) return error('File too large. Maximum size is 10 MB.');
    if (data.byteLength === 0) return error('Empty file data.');
    files.push({ data, type: contentType, name: 'upload' });
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const results: { receipt_id: string; status: string }[] = [];

  for (const file of files) {
    const receiptId = generateId('rcpt');
    const ext = file.type === 'application/pdf' ? 'pdf' : (file.type.split('/')[1] || 'jpg');
    const fileKey = `${bookId}/${year}/${month}/${receiptId}.${ext}`;
    const source = file.type === 'application/pdf' ? 'upload' : 'camera';

    await env.RECEIPTS_BUCKET.put(fileKey, file.data, {
      httpMetadata: { contentType: file.type },
      customMetadata: { bookId, userId, receiptId },
    });

    await env.DB.prepare(
      `INSERT INTO receipts (id, book_id, user_id, source, image_key, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).bind(receiptId, bookId, userId, source, fileKey).run();

    try {
      await env.RECEIPT_WORKFLOW.create({
        id: receiptId,
        params: { receiptId, bookId, userId, imageKey: fileKey },
      });
    } catch (e) {
      await env.DB.prepare("UPDATE receipts SET status = 'processing' WHERE id = ?").bind(receiptId).run();
    }

    results.push({ receipt_id: receiptId, image_key: fileKey, status: 'pending' });
  }

  const msg = results.length === 1 ? 'File uploaded, processing started' : `${results.length} files uploaded, processing started`;
  return success(results.length === 1 ? results[0] : { receipts: results, count: results.length }, msg);
}

export async function getReceiptImage(request: Request, env: Env, userId: string, bookId: string, receiptId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId)) {
    return error('Access denied', 403);
  }

  const receipt = await env.DB.prepare('SELECT image_key FROM receipts WHERE id = ? AND book_id = ?').bind(receiptId, bookId).first<{ image_key: string | null }>();
  if (!receipt?.image_key) return error('No image found', 404);

  const object = await env.RECEIPTS_BUCKET.get(receipt.image_key);
  if (!object) return error('Image not found in storage', 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src * data:",
    },
  });
}

export async function getReceiptAttachment(request: Request, env: Env, userId: string, bookId: string, receiptId: string, attachIndex: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId)) {
    return error('Access denied', 403);
  }

  const receipt = await env.DB.prepare('SELECT attachments FROM receipts WHERE id = ? AND book_id = ?').bind(receiptId, bookId).first<{ attachments: string | null }>();
  if (!receipt?.attachments) return error('No attachments found', 404);

  let attachments: { key: string; filename: string; content_type: string }[];
  try { attachments = JSON.parse(receipt.attachments); } catch { return error('Invalid attachment data', 500); }

  const idx = parseInt(attachIndex);
  if (isNaN(idx) || idx < 0 || idx >= attachments.length) return error('Attachment not found', 404);

  const att = attachments[idx];
  const object = await env.RECEIPTS_BUCKET.get(att.key);
  if (!object) return error('Attachment not found in storage', 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || att.content_type,
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="${att.filename.replace(/["\r\n\\/:<>|?*]/g, '_').slice(0, 200)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src * data:",
    },
  });
}

export async function retryReceipt(request: Request, env: Env, userId: string, bookId: string, receiptId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId, 'member')) {
    return error('Access denied', 403);
  }

  const receipt = await env.DB.prepare(
    'SELECT id, image_key, raw_email, status FROM receipts WHERE id = ? AND book_id = ?'
  ).bind(receiptId, bookId).first<{ id: string; image_key: string | null; raw_email: string | null; status: string }>();

  if (!receipt) return error('Receipt not found', 404);
  if (receipt.status !== 'failed') return error('Only failed receipts can be retried');

  await env.DB.prepare(
    "UPDATE receipts SET status = 'pending', notes = NULL, updated_at = datetime('now') WHERE id = ?"
  ).bind(receiptId).run();

  try {
    await env.RECEIPT_WORKFLOW.create({
      id: receiptId + '_retry_' + Date.now(),
      params: {
        receiptId, bookId, userId,
        imageKey: receipt.image_key || undefined,
        emailBody: receipt.raw_email || undefined,
      },
    });
  } catch {
    await env.DB.prepare("UPDATE receipts SET status = 'processing' WHERE id = ?").bind(receiptId).run();
  }

  return success({ receipt_id: receiptId, status: 'pending' }, 'Receipt queued for reprocessing');
}

export async function getBookSummary(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId)) {
    return error('Access denied', 403);
  }

  const url = new URL(request.url);
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  let dateFilter = '';
  const params: string[] = [bookId];
  if (dateFrom) { dateFilter += ' AND date >= ?'; params.push(dateFrom); }
  if (dateTo) { dateFilter += ' AND date <= ?'; params.push(dateTo); }

  const totalQuery = await env.DB.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total,
     COALESCE(AVG(amount), 0) as average
     FROM receipts WHERE book_id = ? AND status = 'completed'${dateFilter}`
  ).bind(...params).first();

  const byCategory = await env.DB.prepare(
    `SELECT category, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
     FROM receipts WHERE book_id = ? AND status = 'completed'${dateFilter}
     GROUP BY category ORDER BY total DESC`
  ).bind(...params).all();

  const byMonth = await env.DB.prepare(
    `SELECT strftime('%Y-%m', date) as month, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
     FROM receipts WHERE book_id = ? AND status = 'completed' AND date IS NOT NULL${dateFilter}
     GROUP BY month ORDER BY month DESC LIMIT 12`
  ).bind(...params).all();

  const byPaymentMethod = await env.DB.prepare(
    `SELECT payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
     FROM receipts WHERE book_id = ? AND status = 'completed' AND payment_method IS NOT NULL${dateFilter}
     GROUP BY payment_method ORDER BY total DESC`
  ).bind(...params).all();

  return success({
    overview: totalQuery,
    by_category: byCategory.results,
    by_month: byMonth.results,
    by_payment_method: byPaymentMethod.results,
  });
}
