// Phase H1 — pure classification helpers for the receipt-processing pipeline's
// "both AI providers failed" branch.
//
// Kept dependency-free (no `cloudflare:workers` import, no D1/R2/Env) on purpose:
// receipt-processor.ts runs these against real provider errors inside a Workflow
// step, and api/scripts/verify-credit-retry.ts exercises the same functions
// directly under plain Node/tsx. A CF-runtime import here would make the second
// use impossible, since `cloudflare:workers` only resolves inside the Workers
// runtime.

// Errors where the primary provider is structurally unavailable (no credits, revoked key,
// quota exhausted, rate-limited beyond our window). For these we want to fall back to the
// secondary provider rather than retry the primary. Transient 5xx are intentionally NOT
// matched — those should retry the primary via the workflow's standard retry path.
export function isBillingOrAuthError(message: string): boolean {
  if (/credit balance/i.test(message)) return true;
  if (/insufficient[_ ]quota/i.test(message)) return true;
  if (/\bbilling\b/i.test(message)) return true;
  if (/\bquota\b/i.test(message)) return true;
  if (/API error: 401\b/.test(message)) return true;
  if (/API error: 403\b/.test(message)) return true;
  if (/API error: 429\b/.test(message)) return true;
  return false;
}

// Narrower than isBillingOrAuthError: specifically "out of credits / quota",
// the class of failure that is temporary and self-correcting once the user
// tops up. 401/403 (revoked or malformed key) are deliberately excluded here
// — those need the user to fix their key, not wait for a balance to refill,
// so they must stay 'failed' rather than roll into 'awaiting_credits'.
//
// Known looseness, kept deliberately (review finding, 2026-08-16):
//   - \bquota\b and \bbilling\b match anywhere in the message, not just in a
//     provider-shaped "out of credits" phrase.
//   - A bare `API error: 429` (no body text at all) is treated as credit
//     exhaustion, even though 429 is also the status code for an ordinary
//     rate limit unrelated to running out of credits.
// Under the widened sole-provider rule (classifySingleProviderFailed) this
// means a transient rate limit or an unusually-worded genuine error can be
// misclassified as 'awaiting_credits' instead of 'failed'. That is judged
// acceptable, not just tolerated, for two reasons: (1) it is self-correcting
// — H2's cron sweep retries 'awaiting_credits' receipts, so a mislabeled
// transient error just gets retried and normally succeeds or reclassifies on
// the next pass, whereas (2) the asymmetric cost of the other direction is
// worse — a real credit-exhaustion message this function fails to recognize
// stays 'failed' forever with no retry path at all. Given the two failure
// modes are not equally bad, erring toward over-matching here is correct.
// If this needs to be tightened later, do it by requiring quota/billing to
// appear near exhaustion-shaped words (e.g. "exceeded", "insufficient",
// "balance") rather than by dropping the bare-429 case, which is exercised
// by an explicit assertion in api/scripts/verify-credit-retry.ts.
export function isCreditExhaustionError(message: string): boolean {
  if (/credit balance/i.test(message)) return true;
  if (/insufficient[_ ]quota/i.test(message)) return true;
  if (/\bbilling\b/i.test(message)) return true;
  if (/\bquota\b/i.test(message)) return true;
  if (/API error: 429\b/.test(message)) return true;
  return false;
}

// Both-providers-failed classification. awaiting_credits ONLY when BOTH
// providers failed for a credit/quota reason. One credit failure plus one
// genuine failure (bad image, parse error, bad key) must stay 'failed' —
// masking a real failure behind a reassuring "waiting for credits" badge
// would be worse than the bug this exists to fix.
export function classifyBothProvidersFailed(
  primaryMessage: string,
  secondaryMessage: string,
): 'awaiting_credits' | 'failed' {
  if (isCreditExhaustionError(primaryMessage) && isCreditExhaustionError(secondaryMessage)) {
    return 'awaiting_credits';
  }
  return 'failed';
}

// Marker prefix used to encode the both-providers-failed detail as JSON inside
// Error#message. A CF Workflow step boundary only reliably preserves
// Error#message across a step.do retry/rethrow — not a custom Error subclass —
// so the two individual provider messages are encoded here rather than relying
// on `instanceof` in the caller.
const BOTH_PROVIDERS_FAILED_MARKER = 'BOTH_PROVIDERS_FAILED::';

export interface BothProvidersFailedDetail {
  primary: string;
  primaryMsg: string;
  secondary: string;
  secondaryMsg: string;
}

export function encodeBothProvidersFailed(detail: BothProvidersFailedDetail): string {
  return `${BOTH_PROVIDERS_FAILED_MARKER}${JSON.stringify(detail)}`;
}

export function parseBothProvidersFailed(message: string): BothProvidersFailedDetail | null {
  if (!message.startsWith(BOTH_PROVIDERS_FAILED_MARKER)) return null;
  try {
    const parsed = JSON.parse(message.slice(BOTH_PROVIDERS_FAILED_MARKER.length));
    if (
      parsed && typeof parsed.primary === 'string' && typeof parsed.primaryMsg === 'string' &&
      typeof parsed.secondary === 'string' && typeof parsed.secondaryMsg === 'string'
    ) {
      return parsed as BothProvidersFailedDetail;
    }
    return null;
  } catch {
    return null;
  }
}

// Sole-provider classification (widened rule, owner directive 2026-08-16). Hosted
// tenants are provisioned with exactly one AI provider (platform/src/tenant-secrets.ts
// sets OPENAI_API_KEY to ''), so they can never reach the both-providers-failed branch
// above — the primary fails, there is no secondary key (or the primary error isn't
// billing/auth-shaped so no fallback attempt is even made), and the raw error is
// rethrown as-is. Without this, credit exhaustion on a hosted tenant's sole provider
// would stay 'failed' forever and H2's cron sweep would never see it — Phase H would do
// nothing for the users it exists for.
//
// The invariant from the both-providers case still holds here: only classify as
// 'awaiting_credits' when the (single) attempted provider's failure is itself a
// credit-exhaustion error. A genuine failure (bad image, parse error, bad key) on the
// sole provider stays 'failed' — same reasoning as classifyBothProvidersFailed.
export function classifySingleProviderFailed(message: string): 'awaiting_credits' | 'failed' {
  return isCreditExhaustionError(message) ? 'awaiting_credits' : 'failed';
}

// Marker prefix for the sole-provider-failed path, mirroring BOTH_PROVIDERS_FAILED_MARKER
// above and for the same reason: a CF Workflow step boundary only reliably preserves
// Error#message, so the provider name has to be encoded into the message rather than
// carried on a custom Error subclass or closure variable (the `primary`/`secondary`
// locals in receipt-processor.ts's doStep closure aren't visible to the outer catch).
const SINGLE_PROVIDER_FAILED_MARKER = 'SINGLE_PROVIDER_FAILED::';

export interface SingleProviderFailedDetail {
  provider: string;
  message: string;
}

export function encodeSingleProviderFailed(detail: SingleProviderFailedDetail): string {
  return `${SINGLE_PROVIDER_FAILED_MARKER}${JSON.stringify(detail)}`;
}

export function parseSingleProviderFailed(message: string): SingleProviderFailedDetail | null {
  if (!message.startsWith(SINGLE_PROVIDER_FAILED_MARKER)) return null;
  try {
    const parsed = JSON.parse(message.slice(SINGLE_PROVIDER_FAILED_MARKER.length));
    if (parsed && typeof parsed.provider === 'string' && typeof parsed.message === 'string') {
      return parsed as SingleProviderFailedDetail;
    }
    return null;
  } catch {
    return null;
  }
}
