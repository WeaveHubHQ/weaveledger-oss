// Checks for the AI provider fallback chain (weavehub -> anthropic -> openai).
// Run with: bun api/scripts/verify-provider-fallback.ts
import { runWithFallback } from '../src/workflows/provider-fallback';
import {
  parseBothProvidersFailed, parseSingleProviderFailed,
  classifyBothProvidersFailed, classifySingleProviderFailed,
} from '../src/workflows/credit-classification';

type P = 'weavehub' | 'anthropic' | 'openai';
const CREDITS = 'Claude API error: 429 {"error":{"type":"quota_exceeded","message":"No scan credits remaining on this key."}}';
const OPENAI_CREDITS = 'OpenAI API error: 429 {"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}';
const BAD_IMAGE = 'Claude API error: 400 {"error":{"type":"invalid_request_error","message":"Could not process image"}}';

let failed = 0;
function check(name: string, cond: boolean, got?: unknown) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(got)));
  if (!cond) failed++;
}
const runner = (outcomes: Partial<Record<P, string | null>>, calls: P[]) => async (p: P) => {
  calls.push(p);
  const o = outcomes[p];
  if (o) throw new Error(o);
  return p + ' ok';
};
const chain = (ps: P[]) => ps.map((provider) => ({ provider, key: 'k' }));
async function outcome(primary: P, fallbacks: P[], outcomes: Partial<Record<P, string | null>>) {
  const calls: P[] = [];
  try {
    const r = await runWithFallback({ provider: primary, key: 'k' }, chain(fallbacks), runner(outcomes, calls));
    return { calls, ok: r };
  } catch (e) {
    const m = (e as Error).message;
    const both = parseBothProvidersFailed(m);
    const single = parseSingleProviderFailed(m);
    return {
      calls, both, single,
      cls: both ? classifyBothProvidersFailed(both.primaryMsg, both.secondaryMsg) : single ? classifySingleProviderFailed(single.message) : 'unparsed',
    };
  }
}

const main = async () => {
  let r = await outcome('weavehub', ['anthropic', 'openai'], {});
  check('primary works: no fallback tried', r.ok?.providerUsed === 'weavehub' && r.ok.fallbackReason === null && r.calls.length === 1, r);

  r = await outcome('weavehub', ['anthropic', 'openai'], { weavehub: CREDITS });
  check('primary out of credits: anthropic takes it', r.ok?.providerUsed === 'anthropic' && !!r.ok.fallbackReason && r.calls.join() === 'weavehub,anthropic', r);

  r = await outcome('weavehub', ['anthropic', 'openai'], { weavehub: CREDITS, anthropic: CREDITS });
  check('anthropic also out: openai takes it', r.ok?.providerUsed === 'openai' && r.calls.join() === 'weavehub,anthropic,openai', r);

  r = await outcome('weavehub', ['openai'], { weavehub: CREDITS });
  check('no anthropic key: openai is the first fallback', r.ok?.providerUsed === 'openai' && r.calls.join() === 'weavehub,openai', r);

  r = await outcome('weavehub', ['anthropic', 'openai'], { weavehub: CREDITS, anthropic: CREDITS, openai: OPENAI_CREDITS });
  check('all three out of credits -> awaiting_credits', r.cls === 'awaiting_credits' && r.both?.secondary === 'anthropic+openai', r);

  r = await outcome('weavehub', ['anthropic', 'openai'], { weavehub: CREDITS, anthropic: CREDITS, openai: BAD_IMAGE });
  check('one fallback fails for a real reason -> failed', r.cls === 'failed' && r.both?.secondary === 'openai', r);

  r = await outcome('weavehub', ['anthropic', 'openai'], { weavehub: CREDITS, anthropic: BAD_IMAGE, openai: OPENAI_CREDITS });
  check('real failure first, credits second -> still failed', r.cls === 'failed' && r.both?.secondary === 'anthropic', r);

  r = await outcome('weavehub', ['anthropic', 'openai'], { weavehub: BAD_IMAGE });
  check('primary fails for a non-billing reason: no fallback, failed', r.cls === 'failed' && !!r.single && r.calls.length === 1, r);

  r = await outcome('weavehub', [], { weavehub: CREDITS });
  check('sole provider out of credits -> awaiting_credits', r.cls === 'awaiting_credits' && !!r.single, r);

  r = await outcome('anthropic', ['openai'], { anthropic: CREDITS });
  check('anthropic primary still falls back to openai', r.ok?.providerUsed === 'openai', r);

  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
};
main().catch((e) => { console.error('uncaught failure in test chain:', e); process.exit(1); });
