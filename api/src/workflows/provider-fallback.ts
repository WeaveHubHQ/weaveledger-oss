import {
  isBillingOrAuthError,
  isCreditExhaustionError,
  encodeBothProvidersFailed,
  encodeSingleProviderFailed,
} from './credit-classification';

export interface ProviderKey<P extends string> { provider: P; key: string }

/**
 * Try the primary provider, then each fallback in order.
 *
 * A fallback is only attempted when the primary failed for a billing/auth
 * reason (out of credits, bad key) — any other failure would fail the same way
 * elsewhere. Failures are thrown as the structured markers from
 * credit-classification.ts: a CF Workflow step boundary only reliably preserves
 * Error#message, so the caller recovers the provider messages from there to
 * decide 'awaiting_credits' vs 'failed'.
 */
export async function runWithFallback<P extends string, T>(
  primary: ProviderKey<P>,
  fallbacks: ProviderKey<P>[],
  runOnce: (provider: P, key: string) => Promise<T>,
): Promise<{ analysis: T; providerUsed: P; fallbackReason: string | null }> {
  let primaryMsg: string;
  try {
    return { analysis: await runOnce(primary.provider, primary.key), providerUsed: primary.provider, fallbackReason: null };
  } catch (err) {
    primaryMsg = err instanceof Error ? err.message : String(err);
  }

  if (fallbacks.length === 0 || !isBillingOrAuthError(primaryMsg)) {
    // Sole-provider outcome (the common hosted-tenant case has exactly one provider).
    throw new Error(encodeSingleProviderFailed({ provider: primary.provider, message: primaryMsg.slice(0, 500) }));
  }

  const failures: { provider: P; message: string }[] = [];
  for (const fb of fallbacks) {
    try {
      return { analysis: await runOnce(fb.provider, fb.key), providerUsed: fb.provider, fallbackReason: primaryMsg.slice(0, 200) };
    } catch (err) {
      failures.push({ provider: fb.provider, message: err instanceof Error ? err.message : String(err) });
    }
  }

  // The marker has one "secondary" slot, and 'awaiting_credits' requires it to
  // read as credit exhaustion. With several fallbacks that must mean ALL of
  // them: if any failed for another reason, carry only those messages so the
  // receipt is classified 'failed' rather than parked for a retry that can't help.
  const genuine = failures.filter((f) => !isCreditExhaustionError(f.message));
  const carried = genuine.length > 0 ? genuine : failures;
  throw new Error(encodeBothProvidersFailed({
    primary: primary.provider,
    primaryMsg: primaryMsg.slice(0, 500),
    secondary: carried.map((f) => f.provider).join('+'),
    secondaryMsg: carried.map((f) => (carried.length > 1 ? `${f.provider}: ` : '') + f.message.slice(0, 400)).join(' | ').slice(0, 900),
  }));
}
