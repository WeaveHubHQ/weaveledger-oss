// Phase H1 — proves migrations/0032_awaiting_credits.sql does NOT destroy child rows.
// Run with: npx tsx api/scripts/verify-awaiting-credits-migration.ts
//
// Context: the first version of 0032 rebuilt `receipts` via the standard SQLite
// "create-copy-drop-rename" shape (the same shape used safely in
// 0014_fix_environment_check.sql for app_subscriptions, which has zero dependents).
// receipts has FOUR dependents — line_items.receipt_id, receipt_tags.receipt_id,
// expense_report_items.receipt_id (all ON DELETE CASCADE), and
// statement_transactions.matched_receipt_id (ON DELETE SET NULL). D1 enforces
// foreign keys at the connection level, so the naive DROP TABLE receipts performed
// an implicit delete of every row that still had children, which CASCADEd and
// destroyed them. The bug passed local testing because the local dev DB happened to
// have zero child rows at the time — a migration test without child rows proves
// nothing here, which is exactly how this got through review once already.
//
// This script is the guard against that regression: it drives a REAL, disposable
// local D1 database through `wrangler d1` (the exact tool used for both --local
// dev and --remote production applies), seeds a receipt with one row in each of
// the four dependent tables (including a non-NULL statement_transactions
// .matched_receipt_id), applies 0032, and asserts every one of those rows survives
// with its receipt_id/matched_receipt_id intact, plus a `PRAGMA foreign_key_check`
// showing zero violations afterward. It never touches the real project's D1
// binding, dev database, or wrangler.toml — it builds its own throwaway
// wrangler.toml pointing at a brand-new local-only database name/id in a temp
// directory, and deletes that temp directory when done.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_DIR = join(__dirname, '..');
const MIGRATIONS_DIR = join(API_DIR, 'migrations');
const TARGET_MIGRATION = '0032_awaiting_credits.sql';

type Case = { name: string; got: unknown; want: unknown };
const cases: Case[] = [];
const eq = (name: string, got: unknown, want: unknown) => cases.push({ name, got, want });

function wrangler(args: string[], cwd: string): string {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function queryOne(cwd: string, sql: string): Record<string, unknown> {
  const out = wrangler(['d1', 'execute', 'DB', '--local', '--config', './wrangler.toml', '--json', '--command', sql], cwd);
  const parsed = JSON.parse(out) as Array<{ results: Array<Record<string, unknown>> }>;
  return parsed[0]?.results?.[0] ?? {};
}

function queryAll(cwd: string, sql: string): Array<Record<string, unknown>> {
  const out = wrangler(['d1', 'execute', 'DB', '--local', '--config', './wrangler.toml', '--json', '--command', sql], cwd);
  const parsed = JSON.parse(out) as Array<{ results: Array<Record<string, unknown>> }>;
  return parsed[0]?.results ?? [];
}

// Expected schema shape for every table rebuilt by 0032. A future rebuild that
// silently drops an index or reorders/loses a column (both of which SELECT *
// consumers depend on) must fail this script loudly instead of only being caught
// by row-count assertions, which is exactly how the missing
// idx_line_items_receipt_id index got through review once already.
const EXPECTED_INDEXES: Record<string, string[]> = {
  receipts: [
    'idx_receipts_book_id',
    'idx_receipts_user_id',
    'idx_receipts_date',
    'idx_receipts_category',
    'idx_receipts_status',
    'idx_receipts_merchant',
  ],
  line_items: ['idx_line_items_receipt_id'],
  receipt_tags: [],
  expense_report_items: ['idx_expense_report_items_receipt'],
  statement_transactions: [
    'idx_stmt_txns_statement',
    'idx_stmt_txns_book_status',
    'idx_stmt_txns_receipt',
    'idx_stmt_txns_book_fitid',
  ],
};

const EXPECTED_COLUMNS: Record<string, string[]> = {
  receipts: [
    'id', 'book_id', 'user_id', 'merchant', 'amount', 'currency', 'date', 'category',
    'subcategory', 'description', 'payment_method', 'tax_amount', 'tip_amount', 'notes',
    'source', 'image_key', 'raw_email', 'status', 'ai_confidence', 'created_at',
    'updated_at', 'attachments', 'receipt_number', 'invoice_number', 'tax_deductible',
    'tax_category', 'ai_error_detail',
  ],
  line_items: ['id', 'receipt_id', 'description', 'quantity', 'unit_price', 'total'],
  receipt_tags: ['receipt_id', 'tag_id'],
  expense_report_items: ['report_id', 'receipt_id', 'added_at'],
  statement_transactions: [
    'id', 'statement_id', 'book_id', 'date', 'description', 'amount', 'currency',
    'fitid', 'match_status', 'matched_receipt_id', 'match_confidence', 'created_at',
  ],
};

const scratch = mkdtempSync(join(tmpdir(), 'weaveledger-h1-migration-verify-'));
let counts: { before: Record<string, unknown>; after: Record<string, unknown> } | null = null;
let fkViolations: unknown[] = [];

try {
  // 1. Copy every migration EXCEPT 0032 into a scratch migrations dir.
  const migrationsPartial = join(scratch, 'migrations_partial');
  mkdirSync(migrationsPartial);
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (file === TARGET_MIGRATION) continue;
    if (!file.endsWith('.sql')) continue;
    copyFileSync(join(MIGRATIONS_DIR, file), join(migrationsPartial, file));
  }

  // 2. Throwaway wrangler.toml -- brand-new local-only DB name/id, never touches
  //    the real project's binding or dev state.
  writeFileSync(
    join(scratch, 'wrangler.toml'),
    [
      'name = "h1-migration-verify-scratch"',
      'compatibility_date = "2025-01-01"',
      '',
      '[[d1_databases]]',
      'binding = "DB"',
      'database_name = "h1-migration-verify-scratch-db"',
      'database_id = "00000000-0000-0000-0000-00000000h1v1"',
      'migrations_dir = "./migrations_partial"',
      '',
    ].join('\n'),
  );

  // 3. Apply every migration up to (not including) 0032.
  wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--config', './wrangler.toml'], scratch);

  // 4. Seed one receipt with a row in each of the four dependent tables.
  const seedSql = [
    "INSERT INTO users (id, email, name, password_hash) VALUES ('u1','u1@example.com','U1','x');",
    "INSERT INTO books (id, owner_id, name) VALUES ('b1','u1','Book1');",
    "INSERT INTO receipts (id, book_id, user_id, status) VALUES ('r1','b1','u1','completed');",
    "INSERT INTO line_items (id, receipt_id, description, unit_price, total) VALUES ('li1','r1','Widget',1,1);",
    "INSERT INTO tags (id, book_id, name) VALUES ('t1','b1','food');",
    "INSERT INTO receipt_tags (receipt_id, tag_id) VALUES ('r1','t1');",
    "INSERT INTO expense_reports (id, book_id, user_id, title) VALUES ('er1','b1','u1','Report1');",
    "INSERT INTO expense_report_items (report_id, receipt_id) VALUES ('er1','r1');",
    "INSERT INTO statements (id, book_id, user_id, format) VALUES ('s1','b1','u1','csv');",
    "INSERT INTO statement_transactions (id, statement_id, book_id, date, description, amount, matched_receipt_id) VALUES ('st1','s1','b1','2026-01-01','Coffee',5.0,'r1');",
  ].join('\n');
  writeFileSync(join(scratch, 'seed.sql'), seedSql);
  wrangler(['d1', 'execute', 'DB', '--local', '--config', './wrangler.toml', '--file=./seed.sql'], scratch);

  const CHILD_COUNT_SQL = `SELECT
    (SELECT count(*) FROM receipts) AS receipts,
    (SELECT count(*) FROM line_items) AS line_items,
    (SELECT count(*) FROM receipt_tags) AS receipt_tags,
    (SELECT count(*) FROM expense_report_items) AS expense_report_items,
    (SELECT count(*) FROM statement_transactions) AS statement_transactions,
    (SELECT count(*) FROM statement_transactions WHERE matched_receipt_id IS NOT NULL) AS statement_transactions_matched`;

  const before = queryOne(scratch, CHILD_COUNT_SQL);

  // 5. Apply 0032 for real (the migration under test).
  copyFileSync(join(MIGRATIONS_DIR, TARGET_MIGRATION), join(migrationsPartial, TARGET_MIGRATION));
  wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--config', './wrangler.toml'], scratch);

  const after = queryOne(scratch, CHILD_COUNT_SQL);
  counts = { before, after };

  const fkOut = wrangler(['d1', 'execute', 'DB', '--local', '--config', './wrangler.toml', '--json', '--command', 'PRAGMA foreign_key_check;'], scratch);
  fkViolations = (JSON.parse(fkOut) as Array<{ results: unknown[] }>)[0]?.results ?? [];

  // 5b. Schema assertions: every index and column on every rebuilt table must
  // match the pre-migration shape exactly (order matters for `SELECT *` consumers).
  for (const table of Object.keys(EXPECTED_INDEXES)) {
    const rows = queryAll(
      scratch,
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${table}' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name;`,
    );
    const gotIndexes = rows.map((r) => String(r.name)).sort();
    const wantIndexes = [...EXPECTED_INDEXES[table]].sort();
    eq(`after 0032: ${table} indexes match expected set`, gotIndexes, wantIndexes);

    const colRows = queryAll(scratch, `PRAGMA table_info(${table});`);
    const gotColumns = colRows.map((r) => String(r.name));
    eq(`after 0032: ${table} column order matches expected`, gotColumns, EXPECTED_COLUMNS[table]);
  }

  // 6. Sanity: the widened CHECK actually accepts 'awaiting_credits' now.
  wrangler(['d1', 'execute', 'DB', '--local', '--config', './wrangler.toml', '--command', "UPDATE receipts SET status='awaiting_credits' WHERE id='r1';"], scratch);
  const widened = queryOne(scratch, "SELECT status FROM receipts WHERE id='r1';");
  eq("CHECK constraint accepts 'awaiting_credits' after migration", widened.status, 'awaiting_credits');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// --- Assertions: every child row must survive, matched link intact, no FK violations ---

eq('before: receipt exists', counts?.before.receipts, 1);
eq('before: line_items row exists', counts?.before.line_items, 1);
eq('before: receipt_tags row exists', counts?.before.receipt_tags, 1);
eq('before: expense_report_items row exists', counts?.before.expense_report_items, 1);
eq('before: statement_transactions row exists', counts?.before.statement_transactions, 1);
eq('before: statement_transactions.matched_receipt_id is set', counts?.before.statement_transactions_matched, 1);

eq('after 0032: receipt survives', counts?.after.receipts, 1);
eq('after 0032: line_items row survives (NOT cascade-deleted)', counts?.after.line_items, 1);
eq('after 0032: receipt_tags row survives (NOT cascade-deleted)', counts?.after.receipt_tags, 1);
eq('after 0032: expense_report_items row survives (NOT cascade-deleted)', counts?.after.expense_report_items, 1);
eq('after 0032: statement_transactions row survives', counts?.after.statement_transactions, 1);
eq('after 0032: statement_transactions.matched_receipt_id survives (NOT nulled)', counts?.after.statement_transactions_matched, 1);
eq('after 0032: PRAGMA foreign_key_check reports zero violations', fkViolations.length, 0);

let failed = 0;
for (const c of cases) {
  const ok = JSON.stringify(c.got) === JSON.stringify(c.want);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${c.name}  got=${JSON.stringify(c.got)}  want=${JSON.stringify(c.want)}`);
}
console.log(
  `\nchild-row counts -- before: ${JSON.stringify(counts?.before)}`,
  `\nchild-row counts -- after:  ${JSON.stringify(counts?.after)}`,
);
console.log(failed === 0 ? `\n${cases.length}/${cases.length} pass.` : `\n${failed} FAILED.`);
if (failed > 0) process.exit(1);
