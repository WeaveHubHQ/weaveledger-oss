// Phase H4 — Sanity checks for the daily failure-alert email copy.
// Run with: npx tsx api/scripts/verify-failure-alert-copy.ts
//
// We don't have a real test runner wired up (see verify-currency-math.ts and
// verify-credit-retry.ts for the same house pattern). This script imports the
// pure `renderFailureEmail` renderer straight from the service module and
// asserts against the rendered subject/text/html for the cases that matter:
//   - only genuine failures, plural   -> a "could not be processed" sentence, no waiting copy
//   - only genuine failures, singular -> same, with correct singular grammar
//   - only awaiting_credits, plural   -> a "waiting on the AI provider" sentence, no failure copy
//   - only awaiting_credits, singular -> same, with correct singular subject/verb/pronoun agreement
//   - both                            -> both sentences, clearly separated
//   - neither                         -> alertOnRecentFailures must stay quiet (asserted
//                                        separately, since renderFailureEmail is only ever
//                                        called for a row with at least one nonzero count)
//
// Headline defect this exists to catch: a real email the owner received
// contained raw provider JSON (`{"error":{"type":"quota_exceeded",...}`) and
// told him to use "Retry failed" manually — a step H2's cron sweep now does
// automatically. Every case below asserts the rendered body contains NEITHER
// raw provider JSON NOR the old manual-retry instruction for the waiting case.
//
// Second defect this exists to catch (review pass, same task): the real
// email the owner received had waiting_n === 1, and the renderer at the time
// hardcoded plural agreement ("1 receipt ... are waiting ... the receipts
// will retry"). The `-and-singular` cases below exist specifically because
// the original 28 assertions only ever exercised waiting_n: 2 and failed_n: 1
// combined with waiting_n: 5 — never a bare singular waiting_n — so the bug
// that shipped to production would have passed all of them.
//
// Honesty note on coverage (review pass): three assertions from the original
// version of this file were flagged as unable to fail and have been removed
// or replaced, not just left in for a higher count:
//   - `renderFailureEmail.length <= 1` was a tautology — any function
//     destructuring a single parameter has `.length === 1` regardless of
//     what's inside it. Removed; the signature guarantee it was gesturing at
//     is a TypeScript compile-time property (`Pick<FailureRow, 'failed_n' |
//     'waiting_n'>` has no string field to leak), not something a runtime
//     assertion can strengthen. It's now stated here in this comment, honestly,
//     as a compile-time fact rather than dressed up as a passing test.
//   - "does NOT tell the user to use Retry failed ... length <= 1" used
//     `<= 1`, which permits exactly the behavior it names (one occurrence of
//     "Retry failed" in the both-case, from the *failure* sentence, is
//     correct and expected). Tightened to assert the waiting sentence
//     specifically does not contain the phrase, which is the thing that
//     actually matters and can actually fail.
//   - the raw-JSON assertions are still here, but are honestly a signature
//     guarantee (renderFailureEmail never receives a string that could
//     contain JSON) rather than rendering-logic coverage. Kept as
//     regression tripwires in case the signature is ever loosened, not
//     counted as proof of anything beyond that.

import { renderFailureEmail } from '../src/services/failure-alert';

type Case = { name: string; got: unknown; want: unknown };
const cases: Case[] = [];
const eq = (name: string, got: unknown, want: unknown) => cases.push({ name, got, want });
const ok = (name: string, condition: boolean) => cases.push({ name, got: condition, want: true });

// The exact raw provider JSON fragment from the real broken email the owner
// received (see task-H4-brief.md) — must never appear in rendered output.
const RAW_PROVIDER_JSON_FRAGMENT = '{"error":{"type":"quota_exceeded"';

// --- Case 1: only genuine failures (plural) ------------------------------------------------

const onlyFailed = renderFailureEmail({ failed_n: 3, waiting_n: 0 });
ok('only-failures: subject mentions "could not be processed"', onlyFailed.subject.includes('could not be processed'));
ok('only-failures: subject does NOT mention "waiting on the AI provider"', !onlyFailed.subject.includes('waiting on the AI provider'));
ok('only-failures: text does NOT mention waiting/AI provider', !onlyFailed.text.toLowerCase().includes('waiting on the ai provider'));
ok('only-failures: text has no raw provider JSON', !onlyFailed.text.includes(RAW_PROVIDER_JSON_FRAGMENT));
ok('only-failures: html has no raw provider JSON', !onlyFailed.html.includes(RAW_PROVIDER_JSON_FRAGMENT));
ok('only-failures: text has no curly-brace JSON at all', !/\{"[a-z_]+":/i.test(onlyFailed.text));
ok('only-failures: mentions the count', onlyFailed.text.includes('3 receipts'));
ok('only-failures: html positively renders the failure paragraph', onlyFailed.html.includes('failed to process in the last 24 hours'));
ok('only-failures: points at the Notes field for the specific error', onlyFailed.text.includes('Notes'));

// --- Case 1b: only genuine failures (singular) ---------------------------------------------
// The original renderer had no plural/verb agreement bug on this sentence (the verb
// "failed" doesn't inflect for number), but the brief asked us to check it, not assume it.

const onlyFailedSingular = renderFailureEmail({ failed_n: 1, waiting_n: 0 });
ok('only-failures-singular: says "1 receipt" not "1 receipts"', onlyFailedSingular.text.includes('1 receipt ') && !onlyFailedSingular.text.includes('1 receipts'));
ok('only-failures-singular: subject uses singular "1 receipt"', onlyFailedSingular.subject.startsWith('1 receipt could not be processed'));

// --- Case 2: only awaiting_credits (plural) -------------------------------------------------

const onlyWaiting = renderFailureEmail({ failed_n: 0, waiting_n: 2 });
ok('only-waiting: subject mentions "waiting on the AI provider"', onlyWaiting.subject.includes('waiting on the AI provider'));
ok('only-waiting: subject does NOT mention "could not be processed"', !onlyWaiting.subject.includes('could not be processed'));
ok('only-waiting: text does NOT tell the user to use "Retry failed"', !onlyWaiting.text.includes('Retry failed'));
ok('only-waiting: text says it retries automatically', onlyWaiting.text.toLowerCase().includes('retry automatically'));
ok('only-waiting: text says no action is needed', onlyWaiting.text.toLowerCase().includes('no action is needed'));
ok(
  'only-waiting: text does NOT assert credits as the specific cause (no bare "out of credits")',
  !onlyWaiting.text.toLowerCase().includes('out of credits') && !onlyWaiting.text.toLowerCase().includes('you have run out'),
);
ok('only-waiting: text has no raw provider JSON', !onlyWaiting.text.includes(RAW_PROVIDER_JSON_FRAGMENT));
ok('only-waiting: html has no raw provider JSON', !onlyWaiting.html.includes(RAW_PROVIDER_JSON_FRAGMENT));
ok('only-waiting: mentions the count', onlyWaiting.text.includes('2 receipts'));
ok('only-waiting: plural grammar — "2 receipts ... are waiting"', onlyWaiting.text.includes('2 receipts in the last 24 hours are waiting on the AI provider'));
ok('only-waiting: plural pronoun — "they will retry"', onlyWaiting.text.includes('they will retry automatically'));
ok('only-waiting: html positively renders the waiting paragraph', onlyWaiting.html.includes('waiting on the AI provider'));

// --- Case 2b: only awaiting_credits (singular) ----------------------------------------------
// This is the case that actually shipped to the owner and triggered this task: waiting_n
// === 1 renders "1 receipt ... are waiting ... the receipts will retry" if the sentence
// hardcodes plural agreement. These assertions fail loudly against that bug.

const onlyWaitingSingular = renderFailureEmail({ failed_n: 0, waiting_n: 1 });
ok('only-waiting-singular: subject uses singular "1 receipt"', onlyWaitingSingular.subject.startsWith('1 receipt waiting on the AI provider'));
ok('only-waiting-singular: says "1 receipt" not "1 receipts"', onlyWaitingSingular.text.includes('1 receipt ') && !onlyWaitingSingular.text.includes('1 receipts'));
ok('only-waiting-singular: singular verb — "1 receipt ... is waiting" not "are waiting"', onlyWaitingSingular.text.includes('1 receipt in the last 24 hours is waiting on the AI provider'));
ok('only-waiting-singular: does NOT say "are waiting"', !onlyWaitingSingular.text.includes('are waiting'));
ok('only-waiting-singular: singular pronoun — "it will retry" not "the receipts will retry"', onlyWaitingSingular.text.includes('it will retry automatically'));
ok('only-waiting-singular: does NOT say "the receipts will retry"', !onlyWaitingSingular.text.includes('the receipts will retry'));
ok('only-waiting-singular: html has no raw provider JSON', !onlyWaitingSingular.html.includes(RAW_PROVIDER_JSON_FRAGMENT));

// --- Case 3: both -------------------------------------------------------------------------

const both = renderFailureEmail({ failed_n: 1, waiting_n: 5 });
ok('both: subject mentions both "could not be processed" and "waiting on the AI provider"',
  both.subject.includes('could not be processed') && both.subject.includes('waiting on the AI provider'));
ok('both: text has a failure sentence and a waiting sentence, kept separate (blank line between)', both.text.includes('\n\n'));
ok('both: text mentions the failed count', both.text.includes('1 receipt '));
ok('both: text mentions the waiting count', both.text.includes('5 receipts'));
// Tightened from the original `(match(/Retry failed/g) || []).length <= 1`, which permitted
// the exact behavior it claimed to guard (one "Retry failed" from the failure sentence is
// correct here). This now asserts the specific thing that must not happen: the phrase
// leaking into the *waiting* sentence.
ok('both: "Retry failed" does not appear in the waiting portion of the text',
  !both.text.split('\n\n')[1]?.includes('Retry failed'));
ok('both: text has no raw provider JSON', !both.text.includes(RAW_PROVIDER_JSON_FRAGMENT));
ok('both: html has no raw provider JSON', !both.html.includes(RAW_PROVIDER_JSON_FRAGMENT));
ok('both: html positively renders both paragraphs', both.html.includes('failed to process') && both.html.includes('waiting on the AI provider'));

// --- Case 4: neither (must stay silent — asserted at the alertOnRecentFailures level) ----
// renderFailureEmail is only ever invoked by sendFailureEmail for a row the SQL query
// returned, and the query's WHERE clause guarantees failed_n + waiting_n > 0 for every
// returned row (also defensively re-checked in the alertOnRecentFailures loop). We assert
// the empty-result short-circuit directly against the exported function's behavior: with
// zero rows returned, alertOnRecentFailures must never call sendFailureEmail and must
// return the zeroed counters without throwing on a missing D1 binding.

async function assertQuietWhenNothingToReport(): Promise<void> {
  const { alertOnRecentFailures } = await import('../src/services/failure-alert');
  const calls: unknown[] = [];
  const fakeEnv = {
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            calls.push('DB.prepare().bind().all() called');
            return { results: [] };
          },
        }),
      }),
    },
    // Deliberately no RESEND_API_KEY / SEND_EMAIL — if sendFailureEmail were reached with
    // zero rows, it would throw "no outbound email configured" and this would fail loudly.
  } as unknown as Parameters<typeof alertOnRecentFailures>[0];

  const result = await alertOnRecentFailures(fakeEnv);
  eq('neither: queried DB exactly once', calls.length, 1);
  eq('neither: notified is 0', result.notified, 0);
  eq('neither: failures is 0', result.failures, 0);
  eq('neither: waiting is 0', result.waiting, 0);
}

// --- Case 5: the daily-recurrence regression guard ------------------------------------------
// The bug: H2's cron sweep bumps `updated_at` on every parked `awaiting_credits` receipt on
// every 10-minute run, whether or not the retry succeeds. If the SQL query windowed
// `awaiting_credits` on `updated_at` like it windows `failed`, a receipt stuck waiting on
// credits would NEVER age out of the 24-hour window — the "no action is needed" email would
// fire every single day, forever, which is the alert-fatigue outcome this task exists to
// avoid. The fix windows `awaiting_credits` on `created_at` instead, which the sweep never
// touches. We can't spin up a real D1 instance here, so this asserts the shape of the
// generated SQL and bind order directly: the `awaiting_credits` branch of the query must
// reference `created_at`, and must NOT gate `awaiting_credits` rows on `updated_at` alone.

async function assertWaitingWindowUsesCreatedAt(): Promise<void> {
  const { alertOnRecentFailures } = await import('../src/services/failure-alert');
  let capturedSql = '';
  let capturedBinds: unknown[] = [];
  const fakeEnv = {
    DB: {
      prepare: (sql: string) => {
        capturedSql = sql;
        return {
          bind: (...args: unknown[]) => {
            capturedBinds = args;
            return { all: async () => ({ results: [] }) };
          },
        };
      },
    },
  } as unknown as Parameters<typeof alertOnRecentFailures>[0];

  await alertOnRecentFailures(fakeEnv);

  const normalized = capturedSql.replace(/\s+/g, ' ');
  // The awaiting_credits branch of the CASE/WHERE must reference created_at.
  ok(
    'sql: awaiting_credits branch is windowed on created_at (recurrence guard)',
    /awaiting_credits[^)]*r\.created_at/.test(normalized) || /awaiting_credits' AND r\.created_at/.test(normalized),
  );
  // Guard against a regression back to windowing awaiting_credits on updated_at only: the
  // WHERE clause's awaiting_credits disjunct must not gate on updated_at.
  const whereClause = normalized.split(/WHERE/i)[1] || '';
  const awaitingDisjunct = whereClause.split(/OR/i).find((clause) => clause.includes('awaiting_credits')) || '';
  ok(
    "sql: WHERE's awaiting_credits disjunct does not gate on updated_at (would never age out)",
    !awaitingDisjunct.includes('updated_at'),
  );
  ok('sql: failed branch still windows on updated_at (unchanged behavior)', /'failed'[^)]*r\.updated_at/.test(normalized));
  ok('sql: all four window bind params supplied', capturedBinds.length === 4);
}

async function main(): Promise<void> {
  await assertQuietWhenNothingToReport();
  await assertWaitingWindowUsesCreatedAt();

  let failed = 0;
  for (const c of cases) {
    const pass = c.got === c.want;
    if (!pass) failed++;
    console.log(`${pass ? '✓' : '✗'} ${c.name}  got=${JSON.stringify(c.got)}  want=${JSON.stringify(c.want)}`);
  }
  console.log(failed === 0 ? `\n${cases.length}/${cases.length} pass.` : `\n${failed} FAILED.`);
  if (failed > 0) process.exit(1);
}

main();
