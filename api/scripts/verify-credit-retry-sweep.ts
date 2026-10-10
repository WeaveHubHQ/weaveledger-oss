// Phase H2 — sanity checks for the awaiting_credits cron sweep.
// Run with: npx tsx api/scripts/verify-credit-retry-sweep.ts
//
// api/ has no test runner (owner decision — see verify-credit-retry.ts and
// verify-awaiting-credits-migration.ts for the same house pattern). This
// script imports retryAwaitingCredits straight from
// api/src/services/credit-retry.ts — the real production code, not a
// reimplementation — and drives it against an in-memory fake D1Database plus
// a stub RECEIPT_WORKFLOW binding. Stubbing at the RECEIPT_WORKFLOW.create
// boundary (rather than mocking startReceiptProcessing itself) means the
// real reuse path — retryAwaitingCredits -> startReceiptProcessing -> the
// `if (env.RECEIPT_WORKFLOW)` durable-workflow branch — actually executes;
// only the Workflows binding itself (a real Cloudflare resource this script
// must not touch) is faked out.
//
// Asserts, per the task brief's minimum bar:
//   - the sweep selects only status = 'awaiting_credits' (other statuses
//     are left untouched and never handed to the workflow binding)
//   - the per-run cap is respected, and the remainder is left for the next tick
//   - running the sweep twice back-to-back over the same backlog is safe:
//     no double-requeue, no duplicate workflow.create calls per receipt id
//   - a user-authored note on an awaiting_credits receipt is never touched —
//     verified against the ACTUAL SQL text credit-retry.ts sends to D1, not
//     just the fake's resulting state, so a future edit that adds a
//     `notes = ...` clause to the flip-to-pending UPDATE fails this script
//     even if the fake DB would have tolerated it.
//   - when RECEIPT_WORKFLOW.create throws (its only throw path), the receipt
//     is parked back to awaiting_credits for the next tick — NOT left at
//     pending/processing where cleanupStuckReceipts would strand it outside
//     this sweep's selection forever — and is NOT counted in `requeued`.
//
// credit-retry.ts imports startReceiptProcessing from
// receipt-processor.ts, which imports `WorkflowEntrypoint` from the
// `cloudflare:workers` built-in specifier — a module that only resolves
// inside the Workers runtime (see credit-classification.ts's own comment on
// the same constraint). Plain `npx tsx` cannot import that chain directly.
// Rather than reimplement (or skip exercising) the real reuse path, this
// script installs a minimal shim for `cloudflare:workers` via Node's
// `Module._load` BEFORE requiring credit-retry.ts, so the real production
// module graph loads and runs unmodified; only the one binding that is
// exclusively a Cloudflare runtime object is faked.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeModule = require('node:module') as { _load: (...args: unknown[]) => unknown };
const originalLoad = NodeModule._load;
NodeModule._load = function (request: string, ...rest: unknown[]) {
  if (request === 'cloudflare:workers') {
    return {
      WorkflowEntrypoint: class {},
      WorkflowEvent: class {},
      WorkflowStep: class {},
    };
  }
  return (originalLoad as (...a: unknown[]) => unknown).call(NodeModule, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { retryAwaitingCredits } = require('../src/services/credit-retry') as typeof import('../src/services/credit-retry');

type Case = { name: string; got: unknown; want: unknown };
const cases: Case[] = [];
const eq = (name: string, got: unknown, want: unknown) => cases.push({ name, got, want });

interface FakeReceiptRow {
  id: string;
  book_id: string;
  user_id: string;
  image_key: string | null;
  raw_email: string | null;
  status: string;
  notes: string | null;
  updated_at: string;
}

interface FakeEnvHandle {
  env: unknown;
  rows: FakeReceiptRow[];
  workflowCreateCalls: Array<{ id: string; receiptId: string }>;
  sqlLog: string[];
}

// Minimal fake D1Database — only implements the exact statement shapes
// credit-retry.ts actually issues. Anything else throws loudly rather than
// silently no-op'ing, so a future change to the query surface fails this
// script instead of passing vacuously.
function makeFakeEnv(seedRows: FakeReceiptRow[], throwingReceiptIds: string[] = []): FakeEnvHandle {
  const rows: FakeReceiptRow[] = seedRows.map((r) => ({ ...r }));
  const workflowCreateCalls: Array<{ id: string; receiptId: string }> = [];
  const sqlLog: string[] = [];
  const throwing = new Set(throwingReceiptIds);

  const DB = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async all() {
              sqlLog.push(sql);
              if (sql.includes('FROM receipts') && sql.includes("WHERE status = 'awaiting_credits'") && sql.includes('SELECT')) {
                const cap = params[0] as number;
                const results = rows
                  .filter((r) => r.status === 'awaiting_credits')
                  .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
                  .slice(0, cap)
                  .map((r) => ({
                    id: r.id,
                    book_id: r.book_id,
                    user_id: r.user_id,
                    image_key: r.image_key,
                    raw_email: r.raw_email,
                  }));
                return { results };
              }
              throw new Error('fake D1: unexpected .all() query: ' + sql);
            },
            async run() {
              sqlLog.push(sql);
              if (sql.startsWith("UPDATE receipts SET status = 'pending'")) {
                const id = params[0] as string;
                const row = rows.find((r) => r.id === id && r.status === 'awaiting_credits');
                if (!row) return { meta: { changes: 0 } };
                row.status = 'pending';
                row.updated_at = new Date().toISOString();
                return { meta: { changes: 1 } };
              }
              // Park-back after a startReceiptProcessing throw. Matched
              // character-for-character against credit-retry.ts on purpose:
              // this fake throws on any statement it does not recognise, so a
              // change to the real SQL fails here loudly instead of passing
              // vacuously. (It did exactly that when ai_error_detail was added.)
              if (sql.startsWith("UPDATE receipts SET status = 'awaiting_credits', ai_error_detail = ? WHERE id = ? AND status = 'pending'")) {
                const detail = params[0] as string;
                const id = params[1] as string;
                const row = rows.find((r) => r.id === id && r.status === 'pending');
                if (!row) return { meta: { changes: 0 } };
                row.status = 'awaiting_credits';
                row.ai_error_detail = detail;
                row.updated_at = new Date().toISOString();
                return { meta: { changes: 1 } };
              }
              throw new Error('fake D1: unexpected .run() statement: ' + sql);
            },
            async first() {
              throw new Error('fake D1: unexpected .first() query: ' + sql);
            },
          };
        },
      };
    },
  };

  const RECEIPT_WORKFLOW = {
    async create({ id, params }: { id: string; params: { receiptId: string } }) {
      if (throwing.has(params.receiptId)) {
        throw new Error('simulated RECEIPT_WORKFLOW.create failure (e.g. Workflows concurrency limit)');
      }
      workflowCreateCalls.push({ id, receiptId: params.receiptId });
    },
  };

  return { env: { DB, RECEIPT_WORKFLOW }, rows, workflowCreateCalls, sqlLog };
}

function seedRow(id: string, status: string, updatedAt: string, notes: string | null = null): FakeReceiptRow {
  return {
    id,
    book_id: 'book_1',
    user_id: 'user_1',
    image_key: `receipts/${id}.jpg`,
    raw_email: null,
    status,
    notes,
    updated_at: updatedAt,
  };
}

// --- selects only awaiting_credits ------------------------------------------------------

{
  const handle = makeFakeEnv([
    seedRow('r_pending', 'pending', '2026-08-16T00:00:00Z'),
    seedRow('r_processing', 'processing', '2026-08-16T00:00:00Z'),
    seedRow('r_completed', 'completed', '2026-08-16T00:00:00Z'),
    seedRow('r_failed', 'failed', '2026-08-16T00:00:00Z'),
    seedRow('r_awaiting_1', 'awaiting_credits', '2026-08-16T01:00:00Z'),
    seedRow('r_awaiting_2', 'awaiting_credits', '2026-08-16T02:00:00Z'),
  ]);

  retryAwaitingCredits(handle.env as never).then((result) => {
    eq('selects only awaiting_credits: checked count', result.checked, 2);
    eq('selects only awaiting_credits: requeued count', result.requeued, 2);
    eq(
      'non-awaiting_credits rows are left with their original status',
      handle.rows.filter((r) => ['r_pending', 'r_processing', 'r_completed', 'r_failed'].includes(r.id)).map((r) => r.status),
      ['pending', 'processing', 'completed', 'failed'],
    );
    eq(
      'only the awaiting_credits rows were handed to the workflow binding',
      handle.workflowCreateCalls.map((c) => c.receiptId).sort(),
      ['r_awaiting_1', 'r_awaiting_2'],
    );

    runCapTest();
  }).catch(fail);
}

// --- respects the per-run cap ------------------------------------------------------------

function runCapTest() {
  const seeded = Array.from({ length: 30 }, (_, i) =>
    seedRow(`r_backlog_${String(i).padStart(2, '0')}`, 'awaiting_credits', `2026-08-16T${String(i).padStart(2, '0')}:00:00Z`),
  );
  const handle = makeFakeEnv(seeded);

  retryAwaitingCredits(handle.env as never, 25).then((result) => {
    eq('cap: checked is capped at 25 even though 30 are backlogged', result.checked, 25);
    eq('cap: requeued matches checked', result.requeued, 25);
    const stillWaiting = handle.rows.filter((r) => r.status === 'awaiting_credits');
    eq('cap: exactly 5 receipts remain awaiting_credits for the next tick', stillWaiting.length, 5);
    eq(
      'cap: the 5 left behind are the newest (oldest-first ordering drained first)',
      stillWaiting.map((r) => r.id).sort(),
      ['r_backlog_25', 'r_backlog_26', 'r_backlog_27', 'r_backlog_28', 'r_backlog_29'],
    );

    runIdempotencyTest();
  }).catch(fail);
}

// --- idempotent / safe to run twice in the same window ------------------------------------

function runIdempotencyTest() {
  const handle = makeFakeEnv([
    seedRow('r_a', 'awaiting_credits', '2026-08-16T01:00:00Z'),
    seedRow('r_b', 'awaiting_credits', '2026-08-16T02:00:00Z'),
    seedRow('r_c', 'awaiting_credits', '2026-08-16T03:00:00Z'),
  ]);

  retryAwaitingCredits(handle.env as never)
    .then((first) => {
      eq('idempotency: first run requeues all three', first.requeued, 3);

      return retryAwaitingCredits(handle.env as never).then((second) => {
        eq('idempotency: second run in the same window finds nothing left (already flipped to pending)', second.checked, 0);
        eq('idempotency: second run requeues nothing', second.requeued, 0);
        eq(
          'idempotency: no receipt was handed to the workflow binding twice',
          handle.workflowCreateCalls.filter((c) => c.receiptId === 'r_a').length,
          1,
        );
        eq('idempotency: total workflow.create calls across both runs is 3, not 6', handle.workflowCreateCalls.length, 3);
        eq(
          'idempotency: no receipt is left duplicated or dropped — all three ended up pending',
          handle.rows.map((r) => r.status).sort(),
          ['pending', 'pending', 'pending'],
        );

        runNotesPreservationTest();
      });
    })
    .catch(fail);
}

// --- never destroys a user-authored note --------------------------------------------------

function runNotesPreservationTest() {
  const USER_NOTE = 'Bought for the office party — need this for reimbursement, do not lose it';
  const handle = makeFakeEnv([seedRow('r_annotated', 'awaiting_credits', '2026-08-16T01:00:00Z', USER_NOTE)]);

  retryAwaitingCredits(handle.env as never).then((result) => {
    eq('notes preservation: the receipt was requeued', result.requeued, 1);

    const row = handle.rows.find((r) => r.id === 'r_annotated');
    eq("notes preservation: the row's notes field is byte-for-byte unchanged", row?.notes, USER_NOTE);

    // Inspect the ACTUAL SQL the module sent to D1 for the flip-to-pending
    // UPDATE — not just the fake's resulting state — so this fails if a
    // future edit adds a `notes = ...` clause to that statement, even one
    // that happens to be a no-op against this particular fixture.
    const flipStatements = handle.sqlLog.filter((sql) => sql.startsWith("UPDATE receipts SET status = 'pending'"));
    eq('notes preservation: exactly one flip-to-pending UPDATE was issued', flipStatements.length, 1);
    eq(
      "notes preservation: the flip-to-pending UPDATE's SQL text does not reference the notes column at all",
      flipStatements.every((sql) => !sql.includes('notes')),
      true,
    );

    runThrowTest();
  }).catch(fail);
}

// --- RECEIPT_WORKFLOW.create throwing leaves the receipt recoverable ----------------------
//
// startReceiptProcessing's only throw path is RECEIPT_WORKFLOW.create itself
// failing. When that happens nothing is running for the receipt, so it must
// NOT be left at pending/processing (cleanupStuckReceipts would mark it
// 'failed' ~15 minutes later, permanently outside this sweep's selection)
// and must NOT be counted as requeued.
function runThrowTest() {
  const handle = makeFakeEnv(
    [
      // Seeded with a USER-AUTHORED note, not the sentinel: the park-back must
      // not clobber it. H1 and H2 both went to trouble to preserve user notes
      // across the park/re-park cycle; the recovery path must honour that too.
      seedRow('r_throws', 'awaiting_credits', '2026-08-16T01:00:00Z', 'Client dinner - reimbursable'),
      seedRow('r_ok', 'awaiting_credits', '2026-08-16T02:00:00Z'),
    ],
    ['r_throws'],
  );

  retryAwaitingCredits(handle.env as never).then((result) => {
    eq('throw path: checked counts both receipts', result.checked, 2);
    eq('throw path: requeued counts only the one that actually started', result.requeued, 1);

    const thrown = handle.rows.find((r) => r.id === 'r_throws');
    eq(
      "throw path: the receipt whose create() threw is parked back to awaiting_credits, not left at pending/processing",
      thrown?.status,
      'awaiting_credits',
    );

    const ok = handle.rows.find((r) => r.id === 'r_ok');
    eq('throw path: the receipt whose create() succeeded is pending as normal', ok?.status, 'pending');
    // The park-back must RECORD why it failed, not merely log it. Without this
    // a receipt whose create() fails every tick cycles forever looking
    // identical to a healthy park — same status, same notes, and (because the
    // flip clears it) an empty ai_error_detail.
    eq(
      'throw path: the parked-back receipt carries the failure reason in ai_error_detail',
      typeof thrown?.ai_error_detail === 'string' && thrown.ai_error_detail.startsWith('requeue failed:'),
      true,
    );
    eq(
      "throw path: a user-authored note is untouched by the park-back",
      thrown?.notes, 'Client dinner - reimbursable',
    );

    eq(
      'throw path: only the successful receipt was handed to the workflow binding',
      handle.workflowCreateCalls.map((c) => c.receiptId),
      ['r_ok'],
    );

    report();
  }).catch(fail);
}

function fail(e: unknown) {
  console.error('[verify-credit-retry-sweep] uncaught failure in test chain:', e);
  process.exit(1);
}

function report() {
  let failed = 0;
  for (const c of cases) {
    const ok = JSON.stringify(c.got) === JSON.stringify(c.want);
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${c.name}  got=${JSON.stringify(c.got)}  want=${JSON.stringify(c.want)}`);
  }
  console.log(failed === 0 ? `\n${cases.length}/${cases.length} pass.` : `\n${failed} FAILED.`);
  if (failed > 0) process.exit(1);
}
