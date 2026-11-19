import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFrom, fromAddress, splitResinfos } from '../src/services/sender-auth.ts';

const CF_PASS =
  'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=example.org header.s=cf2024-1 header.b=abc;\r\n' +
  ' dmarc=pass header.from=example.org policy.dmarc=reject;\r\n' +
  ' spf=pass (mx.cloudflare.net: domain of x@cf-bounce.example.org designates 1.2.3.4 as permitted sender) smtp.mailfrom=x@cf-bounce.example.org';
const CF_FAIL =
  'Authentication-Results: mx.cloudflare.net; dkim=none; dmarc=fail reason="SPF not aligned (relaxed), No valid DKIM" header.from=example.org policy.dmarc=reject; spf=pass smtp.mailfrom=attacker.example';

const msg = (...headers: string[]) =>
  [...headers, 'To: receipts@ledger.example.com', 'Subject: Receipt', '', 'Total $3.75', ''].join('\r\n');

test('pass: Cloudflare dmarc=pass for the From domain returns the From address', () => {
  assert.equal(authenticatedFrom(msg(CF_PASS, 'From: "Smith, Alice" <Alice@Example.org>')), 'alice@example.org');
});

test('forged From with dmarc=fail is rejected', () => {
  assert.equal(authenticatedFrom(msg(CF_FAIL, 'From: Alice <alice@example.org>')), null);
});

test('forged Authentication-Results lower in the headers is ignored', () => {
  const forged = 'Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=example.org';
  // Cloudflare's real header is topmost and says fail; the sender's pass sits below it.
  assert.equal(authenticatedFrom(msg(CF_FAIL, forged, 'From: alice@example.org')), null);
  // No Cloudflare header at the top at all: a sender-supplied one below other headers is not believed either.
  assert.equal(authenticatedFrom(msg('Received: from evil.example', 'Authentication-Results: evil.example; dmarc=pass header.from=example.org', forged, 'From: alice@example.org')), null);
});

test('missing Authentication-Results is rejected', () => {
  assert.equal(authenticatedFrom(msg('From: alice@example.org')), null);
});

test('dmarc=pass for a different domain than From is rejected', () => {
  assert.equal(authenticatedFrom(msg(CF_PASS, 'From: victim@other.example')), null);
});

test('authserv-id must be exactly mx.cloudflare.net', () => {
  const lookalike = 'Authentication-Results: mx.cloudflare.net.evil.example; dmarc=pass header.from=example.org';
  assert.equal(authenticatedFrom(msg(lookalike, 'From: alice@example.org')), null);
});

test('multiple From headers or a From list are rejected', () => {
  assert.equal(authenticatedFrom(msg(CF_PASS, 'From: a@example.org', 'From: b@example.org')), null);
  assert.equal(authenticatedFrom(msg(CF_PASS, 'From: a@example.org, b@example.org')), null);
});

test('helpers', () => {
  assert.equal(fromAddress('Alice (work) <j@x.org>'), 'j@x.org');
  assert.equal(fromAddress('"a@evil.example, x" <j@x.org>'), 'j@x.org');
  assert.equal(fromAddress('"alice"@example.org'), 'alice@example.org');
  assert.equal(fromAddress('Alice <"alice"@Example.org>'), 'alice@example.org');
  assert.equal(fromAddress('a@x.org, b@x.org'), null);
  assert.equal(fromAddress('<a@x.org>, b@x.org'), null);
  assert.equal(fromAddress('"two words"@x.org'), null);
  assert.deepEqual(splitResinfos('mx; dmarc=pass (a;b) header.from=x.org'), ['mx', 'dmarc=pass  header.from=x.org']);
  assert.equal(splitResinfos('mx; dmarc=pass (unbalanced'), null);
});
