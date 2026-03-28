import { Env } from '../types';
import { error, success } from '../utils/response';
import { canAccessBook } from '../middleware/auth';

const VALID_PERIODS = ['monthly', 'quarterly', 'yearly'];

interface PeriodBucket {
  label: string;
  startDate: string;
  endDate: string;
}

function getMonthlyBuckets(year: number): PeriodBucket[] {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months.map((label, i) => {
    const month = String(i + 1).padStart(2, '0');
    const lastDay = new Date(year, i + 1, 0).getDate();
    return {
      label: `${label} ${year}`,
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
    };
  });
}

function getQuarterlyBuckets(year: number): PeriodBucket[] {
  return [
    { label: `Q1 ${year}`, startDate: `${year}-01-01`, endDate: `${year}-03-31` },
    { label: `Q2 ${year}`, startDate: `${year}-04-01`, endDate: `${year}-06-30` },
    { label: `Q3 ${year}`, startDate: `${year}-07-01`, endDate: `${year}-09-30` },
    { label: `Q4 ${year}`, startDate: `${year}-10-01`, endDate: `${year}-12-31` },
  ];
}

function getYearlyBuckets(year: number): PeriodBucket[] {
  return [
    { label: `${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
  ];
}

export async function getProfitAndLoss(request: Request, env: Env, userId: string, bookId: string): Promise<Response> {
  if (!(await canAccessBook(env.DB, userId, bookId))) {
    return error('Book not found or access denied', 404);
  }

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || 'monthly';
  const year = parseInt(url.searchParams.get('year') || new Date().getFullYear().toString());

  if (!VALID_PERIODS.includes(period)) {
    return error(`Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}`);
  }

  let buckets: PeriodBucket[];
  switch (period) {
    case 'quarterly':
      buckets = getQuarterlyBuckets(year);
      break;
    case 'yearly':
      buckets = getYearlyBuckets(year);
      break;
    default:
      buckets = getMonthlyBuckets(year);
  }

  const periods = [];
  let totalRevenue = 0;
  let totalExpenses = 0;

  for (const bucket of buckets) {
    // Revenue from income_transactions (amount is in cents)
    const revenueResult = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM income_transactions
       WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?`
    ).bind(userId, bucket.startDate, bucket.endDate).first<{ total: number }>();

    // Expenses from receipts
    const expenseResult = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM receipts
       WHERE book_id = ? AND date >= ? AND date <= ? AND status != 'failed'`
    ).bind(bookId, bucket.startDate, bucket.endDate).first<{ total: number }>();

    const revenue = Math.round((revenueResult?.total || 0)) / 100;
    const expenses = Math.round((expenseResult?.total || 0) * 100) / 100;
    const netProfit = Math.round((revenue - expenses) * 100) / 100;
    const margin = revenue > 0 ? Math.round((netProfit / revenue) * 10000) / 100 : 0;

    totalRevenue += revenue;
    totalExpenses += expenses;

    periods.push({
      label: bucket.label,
      revenue,
      expenses,
      netProfit,
      margin,
    });
  }

  totalRevenue = Math.round(totalRevenue * 100) / 100;
  totalExpenses = Math.round(totalExpenses * 100) / 100;
  const totalNetProfit = Math.round((totalRevenue - totalExpenses) * 100) / 100;
  const totalMargin = totalRevenue > 0 ? Math.round((totalNetProfit / totalRevenue) * 10000) / 100 : 0;

  return success({
    year,
    period,
    periods,
    totals: {
      revenue: totalRevenue,
      expenses: totalExpenses,
      netProfit: totalNetProfit,
      margin: totalMargin,
    },
  });
}
