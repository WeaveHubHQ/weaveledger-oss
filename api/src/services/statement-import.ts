import { Env } from '../types';

/**
 * Statement parsing + receipt matching.
 *
 * Import path: OFX (SGML or XML flavors) and CSV. PDF statements are a
 * planned v2 (AI multi-transaction extraction) — see the spec.
 *
 * Only debits (money out) are imported: WeaveLedger tracks expenses, and
 * credits/payments on a card statement have no receipt to match.
 */

export interface ParsedTransaction {
  date: string;        // YYYY-MM-DD
  description: string;
  amount: number;      // positive
  currency: string;
  fitid: string | null;
}

export interface ParsedStatement {
  format: 'ofx' | 'csv';
  accountName: string | null;
  currency: string;
  transactions: ParsedTransaction[];
}

export function sniffFormat(text: string): 'ofx' | 'csv' | null {
  const head = text.slice(0, 2000);
  if (/OFXHEADER|<OFX>|<OFX\s/i.test(head)) return 'ofx';
  // A CSV needs at least a delimiter and a plausible header or data row
  if (head.includes(',') || head.includes(';') || head.includes('\t')) return 'csv';
  return null;
}

export function parseStatement(text: string, format: 'ofx' | 'csv'): ParsedStatement {
  return format === 'ofx' ? parseOfx(text) : parseCsv(text);
}

// --- OFX ---
// OFX 1.x is SGML (unclosed tags), 2.x is XML. Both put each transaction in
// a <STMTTRN>…</STMTTRN> block with <TRNAMT>, <DTPOSTED>, <NAME>/<MEMO>,
// <FITID> leaf values, so a tolerant regex scan handles both flavors.

function parseOfx(text: string): ParsedStatement {
  const currency = ofxValue(text, 'CURDEF') || 'USD';
  const accountName = ofxValue(text, 'ACCTID');

  const transactions: ParsedTransaction[] = [];
  const blockRe = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const block = m[1];
    const amtRaw = ofxValue(block, 'TRNAMT');
    if (!amtRaw) continue;
    const amt = parseFloat(amtRaw.replace(',', '.'));
    if (isNaN(amt) || amt >= 0) continue; // debits only — credits are money in

    const dt = ofxValue(block, 'DTPOSTED') || '';
    const date = ofxDate(dt);
    if (!date) continue;

    const name = ofxValue(block, 'NAME') || '';
    const memo = ofxValue(block, 'MEMO') || '';
    const description = (name && memo && !name.includes(memo) ? `${name} ${memo}` : name || memo || 'Unknown').trim();

    transactions.push({
      date,
      description,
      amount: Math.abs(amt),
      currency,
      fitid: ofxValue(block, 'FITID'),
    });
  }

  return { format: 'ofx', accountName, currency, transactions };
}

/** Leaf value: text after <TAG> up to the next < (SGML) or </TAG> (XML). */
function ofxValue(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i');
  const m = block.match(re);
  const v = m?.[1]?.trim();
  return v || null;
}

/** OFX dates look like 20260315 or 20260315120000[-5:EST]. */
function ofxDate(raw: string): string | null {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return `${y}-${mo}-${d}`;
}

// --- CSV ---

function parseCsv(text: string): ParsedStatement {
  const rows = csvRows(text);
  if (rows.length < 2) return { format: 'csv', accountName: null, currency: 'USD', transactions: [] };

  const header = rows[0].map(h => h.toLowerCase().trim());
  const dateCol = header.findIndex(h => /(^|\s|_)date/.test(h) || h === 'posted');
  const descCol = header.findIndex(h => /desc|payee|merchant|name|detail|memo/.test(h));
  const amountCol = header.findIndex(h => /^amount|amount$|^amt/.test(h));
  const debitCol = header.findIndex(h => /debit|withdrawal|charge/.test(h));
  if (dateCol < 0 || descCol < 0 || (amountCol < 0 && debitCol < 0)) {
    throw new StatementParseError(
      'Could not find date, description, and amount columns in the CSV header. ' +
      `Found columns: ${rows[0].join(', ')}`
    );
  }

  // Two sign conventions exist: banks export expenses as negative amounts,
  // card statements often list charges as positive. Sample the file to
  // decide which sign means "money out".
  const parsed: { date: string; description: string; value: number }[] = [];
  for (const row of rows.slice(1)) {
    if (row.length <= Math.max(dateCol, descCol, Math.max(amountCol, debitCol))) continue;
    const date = csvDate(row[dateCol]);
    if (!date) continue;
    const raw = (debitCol >= 0 && row[debitCol]?.trim()) ? row[debitCol] : (amountCol >= 0 ? row[amountCol] : '');
    const value = parseFloat(raw.replace(/[$,\s]/g, ''));
    if (isNaN(value) || value === 0) continue;
    parsed.push({ date, description: row[descCol].trim() || 'Unknown', value });
  }

  const negatives = parsed.filter(p => p.value < 0).length;
  const expensesAreNegative = debitCol < 0 && negatives >= parsed.length - negatives;

  const transactions: ParsedTransaction[] = [];
  for (const p of parsed) {
    if (debitCol >= 0) {
      // A dedicated debit column is always money out
      transactions.push({ date: p.date, description: p.description, amount: Math.abs(p.value), currency: 'USD', fitid: null });
    } else if (expensesAreNegative ? p.value < 0 : p.value > 0) {
      transactions.push({ date: p.date, description: p.description, amount: Math.abs(p.value), currency: 'USD', fitid: null });
    }
  }

  return { format: 'csv', accountName: null, currency: 'USD', transactions };
}

export class StatementParseError extends Error {}

/** Minimal CSV splitter with quote support. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Accepts YYYY-MM-DD, MM/DD/YYYY, M/D/YY, YYYY/MM/DD. */
function csvDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

// --- Matching ---

export interface MatchCandidate {
  receiptId: string;
  confidence: number;
}

interface ReceiptCandidate {
  id: string;
  merchant: string | null;
  amount: number | null;
  date: string | null;
}

const MS_PER_DAY = 86_400_000;
const SUGGESTION_THRESHOLD = 0.6;

/**
 * Score receipts against transactions and return the best suggestion per
 * transaction index. Greedy by descending confidence so a receipt is
 * suggested to at most one transaction.
 */
export function matchTransactions(
  transactions: Pick<ParsedTransaction, 'date' | 'amount' | 'description'>[],
  receipts: ReceiptCandidate[],
  alreadyMatchedReceiptIds: Set<string>,
): (MatchCandidate | null)[] {
  const scored: { txnIndex: number; receiptId: string; confidence: number }[] = [];

  transactions.forEach((t, txnIndex) => {
    for (const r of receipts) {
      if (alreadyMatchedReceiptIds.has(r.id)) continue;
      if (r.amount == null || r.date == null) continue;

      let score = 0;
      const amountDiff = Math.abs(r.amount - t.amount);
      if (amountDiff < 0.005) score += 0.6;
      else if (amountDiff <= Math.max(0.02, t.amount * 0.01)) score += 0.4;
      else continue;

      const dayDiff = Math.abs(new Date(t.date).getTime() - new Date(r.date).getTime()) / MS_PER_DAY;
      if (dayDiff < 0.5) score += 0.3;
      else if (dayDiff <= 1.5) score += 0.25;
      else if (dayDiff <= 3.5) score += 0.15;
      else if (dayDiff <= 7.5) score += 0.05;
      else continue; // card postings can lag purchases, but not by more than a week

      if (merchantMatches(r.merchant, t.description)) score += 0.15;

      if (score >= SUGGESTION_THRESHOLD) {
        scored.push({ txnIndex, receiptId: r.id, confidence: Math.min(score, 1) });
      }
    }
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  const result: (MatchCandidate | null)[] = new Array(transactions.length).fill(null);
  const usedReceipts = new Set<string>();
  for (const s of scored) {
    if (result[s.txnIndex] || usedReceipts.has(s.receiptId)) continue;
    result[s.txnIndex] = { receiptId: s.receiptId, confidence: s.confidence };
    usedReceipts.add(s.receiptId);
  }
  return result;
}

function merchantMatches(merchant: string | null, description: string): boolean {
  if (!merchant) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = norm(merchant);
  const d = norm(description);
  if (!m || !d) return false;
  if (d.includes(m) || m.includes(d)) return true;
  // Any significant merchant token (4+ chars) appearing in the description
  return m.split(' ').some(tok => tok.length >= 4 && d.includes(tok));
}

/** Load candidate receipts for a book within the statement's date span (±7 days). */
export async function loadCandidateReceipts(
  env: Env, bookId: string, minDate: string, maxDate: string,
): Promise<ReceiptCandidate[]> {
  const pad = (d: string, days: number) => {
    const t = new Date(d + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
  };
  const rows = await env.DB.prepare(
    `SELECT id, merchant, amount, date FROM receipts
     WHERE book_id = ? AND status = 'completed' AND date >= ? AND date <= ?`
  ).bind(bookId, pad(minDate, -7), pad(maxDate, 7)).all<ReceiptCandidate>();
  return rows.results;
}
