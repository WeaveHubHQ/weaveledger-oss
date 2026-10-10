// Phase H1 — Sanity checks for the 'awaiting_credits' receipt-status classification.
// Run with: npx tsx api/scripts/verify-credit-retry.ts
//
// We don't have a real test runner wired up (see verify-currency-math.ts for the same
// house pattern). This script imports the classifier straight from the workflow module
// and asserts the identities the brief requires:
//   - both providers credit-exhausted -> 'awaiting_credits'
//   - credit-exhausted + genuine failure -> 'failed' (never mask a real bug)
//   - both genuine failures -> 'failed'
// Also exercises the message-marker round trip that carries the two provider
// messages across the Workflow step boundary (Error subclasses don't reliably
// survive a CF Workflows step.do retry/rethrow, so the detail is JSON-encoded
// inside Error#message instead — this checks that encode/decode is lossless
// and that malformed/foreign messages are rejected rather than misparsed).
//
// Widened 2026-08-16 (owner directive): a sole attempted provider (the common
// hosted-tenant case — platform/src/tenant-secrets.ts provisions OPENAI_API_KEY as ''
// so there is only ever one provider) must also classify 'awaiting_credits' when its
// failure is credit exhaustion, and 'failed' otherwise. Added the sole-provider cases
// and its own marker round trip below; the both-providers cases above are re-asserted
// unchanged to confirm the widening didn't touch that path.

import {
  isCreditExhaustionError,
  classifyBothProvidersFailed,
  classifySingleProviderFailed,
  parseBothProvidersFailed,
  parseSingleProviderFailed,
} from '../src/workflows/credit-classification';

type Case = { name: string; got: unknown; want: unknown };
const cases: Case[] = [];
const eq = (name: string, got: unknown, want: unknown) => cases.push({ name, got, want });

// --- isCreditExhaustionError: the messages actually seen in production -----------------

eq(
  'Anthropic "credit balance too low" is credit exhaustion',
  isCreditExhaustionError('Your credit balance is too low to access the Anthropic API.'),
  true,
);
eq(
  'WeaveHub gateway quota_exceeded is credit exhaustion',
  isCreditExhaustionError('{"error":"quota_exceeded","message":"Gateway quota exceeded for this billing period"}'),
  true,
);
eq('OpenAI insufficient_quota is credit exhaustion', isCreditExhaustionError('insufficient_quota: You exceeded your current quota'), true);
eq('billing wording is credit exhaustion', isCreditExhaustionError('Your billing details are out of date'), true);
eq('bare 429 is credit exhaustion', isCreditExhaustionError('API error: 429 Too Many Requests'), true);

// --- isCreditExhaustionError: things it must NOT match ----------------------------------
// (401/403 need a fixed key, not a wait — must stay 'failed', not roll into
// 'awaiting_credits' where the cron sweep would retry forever with the same bad key.)

eq('401 invalid API key is NOT credit exhaustion', isCreditExhaustionError('API error: 401 Invalid API key provided'), false);
eq('403 forbidden is NOT credit exhaustion', isCreditExhaustionError('API error: 403 Forbidden'), false);
eq('bad image / parse failure is NOT credit exhaustion', isCreditExhaustionError('Could not parse receipt: no merchant detected'), false);
eq('image not found is NOT credit exhaustion', isCreditExhaustionError('Image not found in R2'), false);
eq('generic 500 is NOT credit exhaustion', isCreditExhaustionError('API error: 500 Internal Server Error'), false);

// --- classifyBothProvidersFailed: the three cases the brief requires at minimum --------

eq(
  'both providers credit-exhausted -> awaiting_credits',
  classifyBothProvidersFailed(
    'Your credit balance is too low to access the Anthropic API.',
    '{"error":"quota_exceeded","message":"Gateway quota exceeded"}',
  ),
  'awaiting_credits',
);

eq(
  'credit-exhausted primary + genuine failure secondary -> failed (do not mask)',
  classifyBothProvidersFailed(
    'Your credit balance is too low to access the Anthropic API.',
    'Could not parse receipt: no merchant detected',
  ),
  'failed',
);

eq(
  'genuine failure primary + credit-exhausted secondary -> failed (do not mask)',
  classifyBothProvidersFailed(
    'Could not parse receipt: no merchant detected',
    'Your credit balance is too low to access the Anthropic API.',
  ),
  'failed',
);

eq(
  'both genuine failures -> failed',
  classifyBothProvidersFailed('Could not parse receipt: no merchant detected', 'Image not found in R2'),
  'failed',
);

eq(
  'both revoked-key (401) -> failed, not awaiting_credits',
  classifyBothProvidersFailed('API error: 401 Invalid API key provided', 'API error: 401 Invalid API key provided'),
  'failed',
);

// --- parseBothProvidersFailed: encode/decode round trip across the step boundary -------

const encoded = `BOTH_PROVIDERS_FAILED::${JSON.stringify({
  primary: 'anthropic',
  primaryMsg: 'Your credit balance is too low to access the Anthropic API.',
  secondary: 'openai',
  secondaryMsg: 'insufficient_quota: You exceeded your current quota',
})}`;
const decoded = parseBothProvidersFailed(encoded);
eq('parseBothProvidersFailed recovers primary provider', decoded?.primary, 'anthropic');
eq('parseBothProvidersFailed recovers primary message', decoded?.primaryMsg, 'Your credit balance is too low to access the Anthropic API.');
eq('parseBothProvidersFailed recovers secondary provider', decoded?.secondary, 'openai');
eq('parseBothProvidersFailed recovers secondary message', decoded?.secondaryMsg, 'insufficient_quota: You exceeded your current quota');

eq('parseBothProvidersFailed rejects an unmarked single-provider message', parseBothProvidersFailed('Image not found in R2'), null);
eq('parseBothProvidersFailed rejects a malformed marker payload', parseBothProvidersFailed('BOTH_PROVIDERS_FAILED::not json'), null);
eq(
  'parseBothProvidersFailed rejects a marker payload missing fields',
  parseBothProvidersFailed(`BOTH_PROVIDERS_FAILED::${JSON.stringify({ primary: 'anthropic' })}`),
  null,
);

// --- End-to-end: decode -> classify, exactly as the outer catch in receipt-processor.ts does ---

const e2eDecoded = parseBothProvidersFailed(encoded);
eq(
  'decode then classify -> awaiting_credits (matches the trigger scenario: Anthropic credit balance + gateway quota_exceeded)',
  e2eDecoded ? classifyBothProvidersFailed(e2eDecoded.primaryMsg, e2eDecoded.secondaryMsg) : 'PARSE_FAILED',
  'awaiting_credits',
);

// --- classifySingleProviderFailed: the widened sole-provider rule ----------------------
// (the hosted-tenant case — exactly one provider ever attempted, no fallback to try)

eq(
  'sole provider, credit-exhaustion error -> awaiting_credits',
  classifySingleProviderFailed('Your credit balance is too low to access the Anthropic API.'),
  'awaiting_credits',
);
eq(
  'sole provider, gateway quota_exceeded -> awaiting_credits',
  classifySingleProviderFailed('{"error":"quota_exceeded","message":"Gateway quota exceeded for this billing period"}'),
  'awaiting_credits',
);
eq(
  'sole provider, bad image / parse error -> failed (do not mask)',
  classifySingleProviderFailed('Could not parse receipt: no merchant detected'),
  'failed',
);
eq(
  'sole provider, image not found -> failed (do not mask)',
  classifySingleProviderFailed('Image not found in R2'),
  'failed',
);
eq(
  'sole provider, revoked key (401) -> failed, not awaiting_credits',
  classifySingleProviderFailed('API error: 401 Invalid API key provided'),
  'failed',
);

// --- parseSingleProviderFailed: encode/decode round trip across the step boundary ------

const singleEncoded = `SINGLE_PROVIDER_FAILED::${JSON.stringify({
  provider: 'anthropic',
  message: 'Your credit balance is too low to access the Anthropic API.',
})}`;
const singleDecoded = parseSingleProviderFailed(singleEncoded);
eq('parseSingleProviderFailed recovers provider', singleDecoded?.provider, 'anthropic');
eq(
  'parseSingleProviderFailed recovers message',
  singleDecoded?.message,
  'Your credit balance is too low to access the Anthropic API.',
);
eq('parseSingleProviderFailed rejects a both-providers marker', parseSingleProviderFailed(encoded), null);
eq('parseSingleProviderFailed rejects an unmarked message', parseSingleProviderFailed('Image not found in R2'), null);
eq('parseSingleProviderFailed rejects a malformed marker payload', parseSingleProviderFailed('SINGLE_PROVIDER_FAILED::not json'), null);
eq(
  'parseSingleProviderFailed rejects a marker payload missing fields',
  parseSingleProviderFailed(`SINGLE_PROVIDER_FAILED::${JSON.stringify({ provider: 'anthropic' })}`),
  null,
);
eq('parseBothProvidersFailed rejects a single-provider marker', parseBothProvidersFailed(singleEncoded), null);

// --- End-to-end: decode -> classify, exactly as the outer catch in receipt-processor.ts does ---

const singleE2eDecoded = parseSingleProviderFailed(singleEncoded);
eq(
  'decode then classify (sole provider) -> awaiting_credits',
  singleE2eDecoded ? classifySingleProviderFailed(singleE2eDecoded.message) : 'PARSE_FAILED',
  'awaiting_credits',
);

let failed = 0;
for (const c of cases) {
  const ok = c.got === c.want;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${c.name}  got=${JSON.stringify(c.got)}  want=${JSON.stringify(c.want)}`);
}
console.log(failed === 0 ? `\n${cases.length}/${cases.length} pass.` : `\n${failed} FAILED.`);
if (failed > 0) process.exit(1);
