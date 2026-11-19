/**
 * Authenticated sender for inbound receipt email.
 *
 * Neither the envelope sender nor the From header is authenticated on its own.
 * Cloudflare Email Routing checks DMARC and PREPENDS an Authentication-Results
 * header before invoking the Worker; anything below it may come from the sender.
 * So the From address is trusted only when the topmost Authentication-Results is
 * from mx.cloudflare.net and records dmarc=pass with header.from equal to the
 * From domain. Anything else returns null (caller rejects).
 */

const TRUSTED_AUTHSERV = 'mx.cloudflare.net';

interface Header { key: string; value: string }

/** Header block of a raw RFC 5322 message, unfolded, in order. */
export function parseHeaders(raw: string): Header[] {
  const end = raw.search(/\r?\n\r?\n/);
  const block = end >= 0 ? raw.slice(0, end) : raw;
  const out: Header[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1].value += ' ' + line.trim();
      continue;
    }
    const i = line.indexOf(':');
    if (i > 0) out.push({ key: line.slice(0, i).trim().toLowerCase(), value: line.slice(i + 1).trim() });
  }
  return out;
}

/**
 * Splits on top-level ';' (RFC 8601), dropping comments; quoted strings and
 * comments protect their content. null when malformed — an unreadable header
 * is not believed.
 */
export function splitResinfos(value: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quoted) {
      if (depth === 0) cur += ch;
      if (ch === '\\') { i++; if (depth === 0) cur += value[i] ?? ''; }
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
      if (depth === 0) cur += ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      if (--depth < 0) return null;
    } else if (depth === 0) {
      if (ch === ';') { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
  }
  if (quoted || depth !== 0) return null;
  out.push(cur.trim());
  return out;
}

/** The single mailbox address in a From value, lowercased; null if absent or a list. */
export function fromAddress(value: string): string | null {
  const QUOTED = /"(?:[^"\\]|\\.)*"/g;
  const v = value.replace(/\([^()]*\)/g, '').trim();
  let spec: string;
  const lt = v.lastIndexOf('<');
  if (lt >= 0) {
    // name-addr: the display name may hold quoted commas; anything else is a list.
    const gt = v.indexOf('>', lt);
    if (gt < 0 || v.slice(gt + 1).trim() || v.slice(0, lt).replace(QUOTED, '').includes(',')) return null;
    spec = v.slice(lt + 1, gt).trim();
  } else {
    if (v.replace(QUOTED, '').includes(',')) return null;
    spec = v;
  }
  // A quoted local part ("alice"@example.org) is the same mailbox as alice@example.org.
  const at = spec.lastIndexOf('@');
  let local = spec.slice(0, at);
  if (/^"(?:[^"\\]|\\.)*"$/.test(local)) local = local.slice(1, -1).replace(/\\(.)/g, '$1');
  const addr = `${local}@${spec.slice(at + 1)}`;
  return at > 0 && /^[^\s@<>",]+@[^\s@<>",]+$/.test(addr) ? addr.toLowerCase() : null;
}

export function authenticatedFrom(raw: string): string | null {
  const headers = parseHeaders(raw);

  const top = headers.find(h => h.key === 'authentication-results');
  if (!top) return null;
  const segs = splitResinfos(top.value);
  if (!segs) return null;
  if (segs[0].split(/\s+/)[0]?.toLowerCase() !== TRUSTED_AUTHSERV) return null;

  const dmarc = segs.slice(1).find(s => /^dmarc\s*=/i.test(s));
  if (!dmarc || !/^dmarc\s*=\s*pass\b/i.test(dmarc)) return null;
  const hf = /\bheader\.from\s*=\s*"?([^\s";]+)"?/i.exec(dmarc);
  if (!hf) return null;

  const froms = headers.filter(h => h.key === 'from');
  if (froms.length !== 1) return null;
  const addr = fromAddress(froms[0].value);
  if (!addr) return null;

  return addr.slice(addr.lastIndexOf('@') + 1) === hf[1].toLowerCase() ? addr : null;
}
