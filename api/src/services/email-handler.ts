import { Env } from '../types';
import { generateId } from '../utils/crypto';

interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  raw: ReadableStream;
  rawSize: number;
  setReject(reason: string): void;
  forward(to: string): Promise<void>;
}

export async function handleInboundEmail(message: EmailMessage, env: Env): Promise<void> {
  const from = message.from;
  const to = message.to;
  const subject = message.headers.get('subject') || 'No Subject';
  console.log(`[Email] Inbound from=${from} to=${to} subject="${subject}" size=${message.rawSize}`);

  // Reject oversized emails (25 MB limit)
  if (message.rawSize > 25 * 1024 * 1024) {
    message.setReject('Email too large');
    return;
  }

  // Note: Cloudflare Email Routing already verifies SPF/DKIM at the routing level
  // before delivering to the Worker. Our security boundary is the sender email lookup
  // below — only registered users (or linked emails) can submit receipts.

  // Verify the sender is a registered user (check primary email and linked emails)
  const senderEmail = from.toLowerCase();
  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(senderEmail).first<{ id: string }>();

  if (!user) {
    // Check linked emails
    const linked = await env.DB.prepare(
      'SELECT user_id FROM user_emails WHERE email = ? AND verified = 1'
    ).bind(senderEmail).first<{ user_id: string }>();
    if (linked) {
      user = { id: linked.user_id };
    }
  }

  if (!user) {
    message.setReject('Sender not registered');
    return;
  }

  // Get the user's default book (first owned book, or create one)
  let book = await env.DB.prepare(
    "SELECT id FROM books WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1"
  ).bind(user.id).first<{ id: string }>();

  if (!book) {
    const bookId = generateId('book');
    await env.DB.prepare(
      'INSERT INTO books (id, owner_id, name, description) VALUES (?, ?, ?, ?)'
    ).bind(bookId, user.id, 'Default', 'Auto-created for email receipts').run();
    book = { id: bookId };
  }

  // Read the raw email
  const rawEmail = await streamToString(message.raw);

  // Extract the original HTML body (preserved for viewing the vendor's receipt)
  const emailHtml = extractEmailHtml(rawEmail);
  // Extract plain text for AI analysis
  const emailBody = extractEmailBody(rawEmail);

  // Check for attachments (images and PDFs)
  const attachments = extractAttachments(rawEmail);

  const receiptId = generateId('rcpt');
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  // Always store the original email HTML in R2 as a fallback
  const emailHtmlKey = `${book.id}/${year}/${month}/${receiptId}_email.html`;
  await env.RECEIPTS_BUCKET.put(emailHtmlKey, emailHtml, {
    httpMetadata: { contentType: 'text/html' },
    customMetadata: { bookId: book.id, userId: user.id, receiptId, source: 'email', type: 'email_html' },
  });

  // Store ALL attachments in R2 and build metadata array
  const storedAttachments: { key: string; filename: string; content_type: string; size: number }[] = [];

  // Always include the email HTML as an attachment option
  storedAttachments.push({
    key: emailHtmlKey, filename: 'Original Email', content_type: 'text/html', size: emailHtml.length,
  });

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const attKey = `${book.id}/${year}/${month}/${receiptId}_${i}.${att.extension}`;
    await env.RECEIPTS_BUCKET.put(attKey, att.data, {
      httpMetadata: { contentType: att.contentType },
      customMetadata: { bookId: book.id, userId: user.id, receiptId, source: 'email' },
    });
    storedAttachments.push({
      key: attKey, filename: att.filename, content_type: att.contentType, size: att.data.length,
    });
  }

  // Pick the best primary: prefer receipt PDF > invoice PDF > any PDF > image > email HTML
  const receiptPdf = storedAttachments.find(a => a.content_type === 'application/pdf' && /receipt/i.test(a.filename));
  const anyPdf = storedAttachments.find(a => a.content_type === 'application/pdf');
  const anyImage = storedAttachments.find(a => a.content_type.startsWith('image/'));
  const primaryKey = (receiptPdf || anyPdf || anyImage || storedAttachments[0]).key;

  if (attachments.length > 0) {
    await env.DB.prepare(
      `INSERT INTO receipts (id, book_id, user_id, source, image_key, raw_email, attachments, status)
       VALUES (?, ?, ?, 'email', ?, ?, ?, 'pending')`
    ).bind(receiptId, book.id, user.id, primaryKey, emailBody, JSON.stringify(storedAttachments)).run();

    try {
      await env.RECEIPT_WORKFLOW.create({
        id: receiptId,
        params: { receiptId, bookId: book.id, userId: user.id, imageKey: primaryKey,
          emailBody, emailSubject: subject, emailFrom: from },
      });
    } catch {
      await env.DB.prepare("UPDATE receipts SET status = 'processing' WHERE id = ?").bind(receiptId).run();
    }
  } else {
    // No file attachments — email HTML is the only document
    await env.DB.prepare(
      `INSERT INTO receipts (id, book_id, user_id, source, image_key, raw_email, attachments, status)
       VALUES (?, ?, ?, 'email', ?, ?, ?, 'pending')`
    ).bind(receiptId, book.id, user.id, emailHtmlKey, emailBody, JSON.stringify(storedAttachments)).run();

    try {
      await env.RECEIPT_WORKFLOW.create({
        id: receiptId,
        params: {
          receiptId, bookId: book.id, userId: user.id,
          emailBody, emailSubject: subject, emailFrom: from,
        },
      });
    } catch {
      await env.DB.prepare("UPDATE receipts SET status = 'processing' WHERE id = ?").bind(receiptId).run();
    }
  }
}

async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }

  return result;
}

function decodePartBody(headers: string, body: string): string {
  if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) {
    try {
      const raw = atob(body.replace(/\s/g, ''));
      // Convert binary string to UTF-8 via TextDecoder
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      body = new TextDecoder('utf-8').decode(bytes);
    } catch { /* use raw */ }
  }
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) {
    // Decode quoted-printable to bytes first, then interpret as UTF-8
    const unfolded = body.replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < unfolded.length; i++) {
      if (unfolded[i] === '=' && i + 2 < unfolded.length && /[0-9A-Fa-f]{2}/.test(unfolded.slice(i + 1, i + 3))) {
        bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(unfolded.charCodeAt(i));
      }
    }
    body = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
  // Clean up non-breaking spaces and other common artifacts
  body = body.replace(/\u00A0/g, ' ');
  return body;
}

function findAllHtmlParts(raw: string): string[] {
  const results: string[] = [];
  // Find all boundaries in the content (handles nested multipart)
  const boundaryMatches = raw.matchAll(/boundary="?([^";\r\n]+)"?/gi);
  for (const match of boundaryMatches) {
    const boundary = match[1];
    const parts = raw.split(`--${boundary}`);
    for (const part of parts) {
      if (/Content-Type:\s*text\/html/i.test(part)) {
        const dataStart = part.indexOf('\r\n\r\n');
        if (dataStart === -1) continue;
        const partHeaders = part.slice(0, dataStart);
        const body = part.slice(dataStart + 4);
        // Strip any trailing boundary markers
        const decoded = decodePartBody(partHeaders, body.replace(/--[^\r\n]+--\s*$/, '').trim());
        if (decoded.length > 50) results.push(decoded);
      }
    }
  }
  return results;
}

function extractEmailHtml(rawEmail: string): string {
  // Find ALL text/html parts across all MIME boundaries (including nested ones)
  // For forwarded emails, the last HTML part is typically the original receipt
  const htmlParts = findAllHtmlParts(rawEmail);

  if (htmlParts.length > 0) {
    // Prefer the part that looks most like an original receipt/invoice:
    // - Has structured content (tables, specific receipt-like keywords)
    // - Is NOT the forwarding wrapper (which tends to contain raw MIME text)
    // If there are multiple, pick the one least likely to be Gmail's wrapper
    let best = htmlParts[htmlParts.length - 1]; // default to last (deepest)
    for (const part of htmlParts) {
      // Skip parts that contain raw MIME content (boundary markers, Content-Type headers visible as text)
      if (/Content-Transfer-Encoding:\s*base64/i.test(part) && /boundary=/i.test(part)) continue;
      // Prefer parts with receipt/invoice indicators
      if (/receipt|invoice|payment|amount|total/i.test(part)) {
        best = part;
      }
    }
    return best.slice(0, 500000);
  }

  // Non-multipart: check if the whole email body is HTML
  const headerEnd = rawEmail.indexOf('\r\n\r\n');
  if (headerEnd === -1) return '<pre>' + rawEmail.replace(/</g, '&lt;') + '</pre>';
  const headers = rawEmail.slice(0, headerEnd);
  let body = rawEmail.slice(headerEnd + 4);
  body = decodePartBody(headers, body);

  if (/Content-Type:\s*text\/html/i.test(headers) || /<html/i.test(body)) {
    return body.slice(0, 500000);
  }

  // Plain text fallback — wrap in pre
  return '<pre style="font-family:sans-serif;white-space:pre-wrap;padding:20px">' + body.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
}

function extractEmailBody(rawEmail: string): string {
  // Split headers from body
  const headerBodySplit = rawEmail.indexOf('\r\n\r\n');
  if (headerBodySplit === -1) return rawEmail;

  let body = rawEmail.slice(headerBodySplit + 4);

  // Strip HTML tags for a simple text extraction
  body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<[^>]+>/g, ' ');
  body = body.replace(/&nbsp;/g, ' ');
  body = body.replace(/&amp;/g, '&');
  body = body.replace(/&lt;/g, '<');
  body = body.replace(/&gt;/g, '>');
  body = body.replace(/\s+/g, ' ').trim();

  return body.slice(0, 10000); // Limit size
}

interface Attachment {
  filename: string;
  contentType: string;
  extension: string;
  data: Uint8Array;
}

function extractAttachments(rawEmail: string): Attachment[] {
  const attachments: Attachment[] = [];

  // Find boundary
  const boundaryMatch = rawEmail.match(/boundary="?([^";\r\n]+)"?/i);
  if (!boundaryMatch) return attachments;

  const boundary = boundaryMatch[1];
  const parts = rawEmail.split(`--${boundary}`);

  for (const part of parts) {
    const contentTypeMatch = part.match(/Content-Type:\s*(image\/\w+|application\/pdf)/i);
    if (!contentTypeMatch) continue;

    const contentType = contentTypeMatch[1];
    const extension = contentType === 'application/pdf' ? 'pdf' : (contentType.split('/')[1] || 'jpg');

    const filenameMatch = part.match(/filename="?([^";\r\n]+)"?/i);
    const filename = filenameMatch?.[1] || `receipt.${extension}`;

    // Find base64 encoded data
    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*base64/i);
    if (!encodingMatch) continue;

    const dataStart = part.indexOf('\r\n\r\n');
    if (dataStart === -1) continue;

    const base64Data = part.slice(dataStart + 4).replace(/\s/g, '');
    try {
      const binaryString = atob(base64Data);
      const data = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        data[i] = binaryString.charCodeAt(i);
      }
      attachments.push({ filename, contentType, extension, data });
    } catch {
      // Skip invalid base64
    }
  }

  return attachments;
}
