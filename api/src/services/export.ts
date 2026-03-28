import { Env, ExportFormat } from '../types';
import { error } from '../utils/response';
import { canAccessBook } from '../middleware/auth';

interface ReceiptRow {
  id: string;
  merchant: string | null;
  amount: number | null;
  currency: string;
  date: string | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  payment_method: string | null;
  tax_amount: number | null;
  tip_amount: number | null;
  notes: string | null;
  source: string;
  status: string;
  created_at: string;
}

export async function exportBook(request: Request, env: Env, userId: string, bookId: string, format: ExportFormat): Promise<Response> {
  if (!await canAccessBook(env.DB, userId, bookId)) {
    return error('Access denied', 403);
  }

  const url = new URL(request.url);
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');
  const category = url.searchParams.get('category');

  let query = "SELECT * FROM receipts WHERE book_id = ? AND status = 'completed'";
  const params: (string | number)[] = [bookId];

  if (dateFrom) { query += ' AND date >= ?'; params.push(dateFrom); }
  if (dateTo) { query += ' AND date <= ?'; params.push(dateTo); }
  if (category) { query += ' AND category = ?'; params.push(category); }

  query += ' ORDER BY date DESC';

  const results = await env.DB.prepare(query).bind(...params).all<ReceiptRow>();
  const receipts = results.results;

  const book = await env.DB.prepare('SELECT name, currency FROM books WHERE id = ?').bind(bookId).first<{ name: string; currency: string }>();
  const bookName = sanitizeFilename(book?.name || 'export');

  switch (format) {
    case 'csv': return exportCSV(receipts, bookName);
    case 'json': return exportJSON(receipts, bookName);
    case 'qbo': return exportQBO(receipts, bookName, book?.currency || 'USD');
    case 'ofx': return exportOFX(receipts, bookName, book?.currency || 'USD');
    case 'pdf': return exportPDFData(receipts, bookName);
    default: return error('Unsupported format');
  }
}

function exportCSV(receipts: ReceiptRow[], bookName: string): Response {
  const headers = ['Date', 'Merchant', 'Amount', 'Currency', 'Category', 'Subcategory', 'Description', 'Payment Method', 'Tax', 'Tip', 'Notes', 'Source'];
  const rows = receipts.map(r => [
    r.date || '', csvEscape(r.merchant || ''), r.amount?.toString() || '', r.currency,
    csvEscape(r.category || ''), csvEscape(r.subcategory || ''), csvEscape(r.description || ''),
    csvEscape(r.payment_method || ''), r.tax_amount?.toString() || '', r.tip_amount?.toString() || '',
    csvEscape(r.notes || ''), r.source,
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${bookName}_export.csv"`,
    },
  });
}

function exportJSON(receipts: ReceiptRow[], bookName: string): Response {
  const data = {
    book: bookName,
    exported_at: new Date().toISOString(),
    count: receipts.length,
    total: receipts.reduce((sum, r) => sum + (r.amount || 0), 0),
    receipts: receipts.map(r => ({
      date: r.date,
      merchant: r.merchant,
      amount: r.amount,
      currency: r.currency,
      category: r.category,
      subcategory: r.subcategory,
      description: r.description,
      payment_method: r.payment_method,
      tax_amount: r.tax_amount,
      tip_amount: r.tip_amount,
      notes: r.notes,
      source: r.source,
    })),
  };

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${bookName}_export.json"`,
    },
  });
}

function exportQBO(receipts: ReceiptRow[], bookName: string, currency: string): Response {
  // QBO (QuickBooks) IIF format
  const lines: string[] = [];
  lines.push('!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO');
  lines.push('!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO');
  lines.push('!ENDTRNS');

  for (const r of receipts) {
    if (!r.amount || !r.date) continue;
    const date = formatQBDate(r.date);
    const amount = (-r.amount).toFixed(2);
    const memo = iifEscape(r.description || r.merchant || '');
    const merchant = iifEscape(r.merchant || '');
    const category = iifEscape(r.category || 'Expenses');

    lines.push(`TRNS\tCHECK\t${date}\tChecking\t${merchant}\t${amount}\t${memo}`);
    lines.push(`SPL\tCHECK\t${date}\t${category}\t${merchant}\t${r.amount.toFixed(2)}\t${memo}`);
    lines.push('ENDTRNS');
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'application/x-qbooks',
      'Content-Disposition': `attachment; filename="${bookName}_export.iif"`,
    },
  });
}

function exportOFX(receipts: ReceiptRow[], bookName: string, currency: string): Response {
  const now = new Date();
  const dtserver = formatOFXDate(now);

  if (receipts.length === 0) {
    const emptyOfx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${dtserver}
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>0
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>${currency}
<BANKACCTFROM>
<BANKID>000000000
<ACCTID>WeaveLedger
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${dtserver}
<DTEND>${dtserver}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>0.00
<DTASOF>${dtserver}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

    return new Response(emptyOfx, {
      headers: {
        'Content-Type': 'application/x-ofx',
        'Content-Disposition': `attachment; filename="${bookName}_export.ofx"`,
      },
    });
  }

  let transactions = '';
  for (const r of receipts) {
    if (!r.amount || !r.date) continue;
    const dtposted = formatOFXDate(new Date(r.date));
    transactions += `
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>${dtposted}
<TRNAMT>-${r.amount.toFixed(2)}
<FITID>${r.id}
<NAME>${xmlEscape(r.merchant || 'Unknown')}
<MEMO>${xmlEscape(r.description || r.category || '')}
</STMTTRN>`;
  }

  const total = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);
  const oldestDate = receipts[receipts.length - 1]?.date;

  const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${dtserver}
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>0
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>${currency}
<BANKACCTFROM>
<BANKID>000000000
<ACCTID>WeaveLedger
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${formatOFXDate(new Date(oldestDate!))}
<DTEND>${dtserver}${transactions}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-${total.toFixed(2)}
<DTASOF>${dtserver}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

  return new Response(ofx, {
    headers: {
      'Content-Type': 'application/x-ofx',
      'Content-Disposition': `attachment; filename="${bookName}_export.ofx"`,
    },
  });
}

function exportPDFData(receipts: ReceiptRow[], bookName: string): Response {
  // Return structured data for client-side PDF generation
  // (Cloudflare Workers can't generate full PDFs without heavy dependencies,
  //  so we provide structured data the iOS app renders to PDF)
  const total = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);
  const byCategory: Record<string, { count: number; total: number }> = {};

  for (const r of receipts) {
    const cat = r.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0 };
    byCategory[cat].count++;
    byCategory[cat].total += r.amount || 0;
  }

  const data = {
    format: 'pdf_data',
    book: bookName,
    exported_at: new Date().toISOString(),
    summary: { count: receipts.length, total, by_category: byCategory },
    receipts: receipts.map(r => ({
      date: r.date, merchant: r.merchant, amount: r.amount,
      currency: r.currency, category: r.category, description: r.description,
      payment_method: r.payment_method, tax_amount: r.tax_amount,
    })),
  };

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${bookName}_export_pdf_data.json"`,
    },
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n\\/:<>|?*]/g, '_').replace(/[^\x20-\x7E]/g, '_').slice(0, 100);
}

function iifEscape(value: string): string {
  return value.replace(/[\t\r\n]/g, ' ');
}

function csvEscape(value: string): string {
  // Prevent CSV formula injection by prefixing dangerous first characters
  let escaped = value;
  if (/^[=+\-@\t\r]/.test(escaped)) {
    escaped = `'${escaped}`;
  }
  if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function formatQBDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatOFXDate(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}
