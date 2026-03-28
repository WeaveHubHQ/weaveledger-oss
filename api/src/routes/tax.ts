import { Env } from '../types';
import { generateId } from '../utils/crypto';
import { error, success } from '../utils/response';
import { canAccessBook } from '../middleware/auth';

const IRS_SCHEDULE_C_CATEGORIES = [
  'Advertising',
  'Car & Truck Expenses',
  'Commissions & Fees',
  'Contract Labor',
  'Depreciation',
  'Employee Benefits',
  'Insurance',
  'Interest (Mortgage/Other)',
  'Legal & Professional',
  'Office Expense',
  'Pension & Profit-Sharing',
  'Rent (Vehicles/Equipment/Other)',
  'Repairs & Maintenance',
  'Supplies',
  'Taxes & Licenses',
  'Travel',
  'Meals',
  'Utilities',
  'Wages',
  'Other Expenses',
];

const VALID_FILING_STATUSES = ['sole_proprietor', 'single_member_llc', 'llc_partnership', 's_corp', 'c_corp', 'nonprofit'];

export async function getTaxCategories(request: Request, env: Env, userId: string): Promise<Response> {
  return success(IRS_SCHEDULE_C_CATEGORIES);
}

export async function getTaxSettings(request: Request, env: Env, userId: string): Promise<Response> {
  let settings = await env.DB.prepare(
    'SELECT * FROM tax_settings WHERE user_id = ?'
  ).bind(userId).first();

  if (!settings) {
    // Create default settings
    const id = generateId('tax');
    await env.DB.prepare(
      'INSERT INTO tax_settings (id, user_id) VALUES (?, ?)'
    ).bind(id, userId).run();

    settings = await env.DB.prepare('SELECT * FROM tax_settings WHERE id = ?').bind(id).first();
  }

  return success(settings);
}

export async function updateTaxSettings(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json<{
    filing_status?: string;
    estimated_annual_tax_rate?: number;
    state?: string;
    state_tax_rate?: number;
    self_employment_tax_rate?: number;
  }>();

  if (body.filing_status !== undefined && !VALID_FILING_STATUSES.includes(body.filing_status)) {
    return error(`Invalid filing status. Must be one of: ${VALID_FILING_STATUSES.join(', ')}`);
  }
  if (body.estimated_annual_tax_rate !== undefined && (typeof body.estimated_annual_tax_rate !== 'number' || body.estimated_annual_tax_rate < 0 || body.estimated_annual_tax_rate > 100)) {
    return error('estimated_annual_tax_rate must be between 0 and 100');
  }
  if (body.state_tax_rate !== undefined && (typeof body.state_tax_rate !== 'number' || body.state_tax_rate < 0 || body.state_tax_rate > 100)) {
    return error('state_tax_rate must be between 0 and 100');
  }
  if (body.self_employment_tax_rate !== undefined && (typeof body.self_employment_tax_rate !== 'number' || body.self_employment_tax_rate < 0 || body.self_employment_tax_rate > 100)) {
    return error('self_employment_tax_rate must be between 0 and 100');
  }

  // Ensure settings exist (upsert)
  let existing = await env.DB.prepare('SELECT id FROM tax_settings WHERE user_id = ?').bind(userId).first<{ id: string }>();
  if (!existing) {
    const id = generateId('tax');
    await env.DB.prepare('INSERT INTO tax_settings (id, user_id) VALUES (?, ?)').bind(id, userId).run();
    existing = { id };
  }

  const current = await env.DB.prepare('SELECT * FROM tax_settings WHERE id = ?').bind(existing.id).first() as any;

  const filingStatus = body.filing_status || current.filing_status;
  const annualRate = body.estimated_annual_tax_rate ?? current.estimated_annual_tax_rate;
  const state = body.state !== undefined ? (body.state || null) : current.state;
  const stateRate = body.state_tax_rate ?? current.state_tax_rate;
  const seRate = body.self_employment_tax_rate ?? current.self_employment_tax_rate;

  await env.DB.prepare(
    "UPDATE tax_settings SET filing_status = ?, estimated_annual_tax_rate = ?, state = ?, state_tax_rate = ?, self_employment_tax_rate = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(filingStatus, annualRate, state, stateRate, seRate, existing.id).run();

  const updated = await env.DB.prepare('SELECT * FROM tax_settings WHERE id = ?').bind(existing.id).first();
  return success(updated);
}

export async function getTaxSummary(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const url = new URL(request.url);
  const year = url.searchParams.get('year') || new Date().getFullYear().toString();
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const results = await env.DB.prepare(
    `SELECT tax_category, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
     FROM receipts
     WHERE book_id = ? AND tax_deductible = 1 AND date >= ? AND date <= ? AND status != 'failed'
     GROUP BY tax_category
     ORDER BY total DESC`
  ).bind(bookId, startDate, endDate).all();

  const grandTotal = (results.results as any[]).reduce((sum, row) => sum + (row.total || 0), 0);

  return success({
    year,
    categories: results.results,
    grandTotal,
  });
}

export async function getTaxEstimates(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const url = new URL(request.url);
  const year = parseInt(url.searchParams.get('year') || new Date().getFullYear().toString());
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // Get tax settings
  let settings = await env.DB.prepare('SELECT * FROM tax_settings WHERE user_id = ?').bind(userId).first() as any;
  if (!settings) {
    // Use defaults
    settings = {
      estimated_annual_tax_rate: 25.0,
      state_tax_rate: 0,
      self_employment_tax_rate: 15.3,
    };
  }

  // YTD income from income_transactions (amount is in cents)
  const incomeResult = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total_income
     FROM income_transactions
     WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?`
  ).bind(userId, startDate, endDate).first<{ total_income: number }>();

  // YTD deductible expenses
  const deductionsResult = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total_deductions
     FROM receipts
     WHERE book_id = ? AND tax_deductible = 1 AND date >= ? AND date <= ? AND status != 'failed'`
  ).bind(bookId, startDate, endDate).first<{ total_deductions: number }>();

  const totalIncome = (incomeResult?.total_income || 0) / 100; // cents to dollars
  const totalDeductions = deductionsResult?.total_deductions || 0;
  const netTaxable = Math.max(0, totalIncome - totalDeductions);

  // Calculate total tax rate
  const federalRate = settings.estimated_annual_tax_rate / 100;
  const seRate = settings.self_employment_tax_rate / 100;
  const stateRate = settings.state_tax_rate / 100;
  const totalRate = federalRate + seRate + stateRate;

  const estimatedAnnualTax = netTaxable * totalRate;
  const quarterlyTax = estimatedAnnualTax / 4;

  // IRS quarterly due dates
  const quarters = [
    { label: 'Q1', period: `Jan-Mar ${year}`, dueDate: `${year}-04-15`, months: [1, 2, 3] },
    { label: 'Q2', period: `Apr-Jun ${year}`, dueDate: `${year}-06-15`, months: [4, 5, 6] },
    { label: 'Q3', period: `Jul-Sep ${year}`, dueDate: `${year}-09-15`, months: [7, 8, 9] },
    { label: 'Q4', period: `Oct-Dec ${year}`, dueDate: `${year + 1}-01-15`, months: [10, 11, 12] },
  ];

  // Check what's already been paid (receipts in "Taxes & Fees" category for this year)
  const paidResults = await env.DB.prepare(
    `SELECT date, COALESCE(SUM(amount), 0) as paid
     FROM receipts
     WHERE book_id = ? AND category = 'Taxes & Fees' AND date >= ? AND date <= ? AND status != 'failed'
     GROUP BY SUBSTR(date, 6, 2)`
  ).bind(bookId, startDate, endDate).all();

  // Map paid amounts to quarters
  const paidByMonth: Record<number, number> = {};
  for (const row of paidResults.results as any[]) {
    if (row.date) {
      const month = parseInt(row.date.substring(5, 7));
      paidByMonth[month] = (paidByMonth[month] || 0) + row.paid;
    }
  }

  const quarterDetails = quarters.map(q => {
    const paid = q.months.reduce((sum, m) => sum + (paidByMonth[m] || 0), 0);
    return {
      label: q.label,
      period: q.period,
      dueDate: q.dueDate,
      estimatedTax: Math.round(quarterlyTax * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      remainingDue: Math.round(Math.max(0, quarterlyTax - paid) * 100) / 100,
    };
  });

  return success({
    year,
    income: Math.round(totalIncome * 100) / 100,
    deductions: Math.round(totalDeductions * 100) / 100,
    netTaxable: Math.round(netTaxable * 100) / 100,
    rates: {
      federal: settings.estimated_annual_tax_rate,
      selfEmployment: settings.self_employment_tax_rate,
      state: settings.state_tax_rate,
      effectiveTotal: Math.round(totalRate * 10000) / 100,
    },
    estimatedAnnualTax: Math.round(estimatedAnnualTax * 100) / 100,
    quarters: quarterDetails,
  });
}
