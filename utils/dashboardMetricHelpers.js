/**
 * Shared helpers for business dashboard analytics (range boundaries, deltas, QA).
 * Used by businessController.getDashboardData and verification scripts.
 */

/** IANA timezone for heatmap hour / day-of-week bucketing (override via DASHBOARD_HEATMAP_TZ). */
const DASHBOARD_HEATMAP_TIMEZONE = process.env.DASHBOARD_HEATMAP_TZ || 'Africa/Cairo';

/**
 * Compute date boundaries for a range string.
 * @returns {{ start: Date, end: Date, prevStart: Date, prevEnd: Date }}
 */
function resolveDashboardRange(rangeParam, fromParam, toParam) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  let start;
  let end;

  switch (String(rangeParam || '30d').toLowerCase()) {
    case 'today':
      start = todayStart;
      end = todayEnd;
      break;
    case '7d':
      start = new Date(todayStart);
      start.setDate(start.getDate() - 6);
      end = todayEnd;
      break;
    case '90d':
      start = new Date(todayStart);
      start.setDate(start.getDate() - 89);
      end = todayEnd;
      break;
    case 'ytd':
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      end = todayEnd;
      break;
    case 'custom':
      start = fromParam ? new Date(fromParam) : new Date(todayStart);
      end = toParam ? new Date(toParam) : todayEnd;
      if (Number.isNaN(start.getTime())) start = new Date(todayStart);
      if (Number.isNaN(end.getTime())) end = todayEnd;
      end.setHours(23, 59, 59, 999);
      break;
    case '30d':
    default:
      start = new Date(todayStart);
      start.setDate(start.getDate() - 29);
      end = todayEnd;
      break;
  }

  const spanMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - spanMs);

  return { start, end, prevStart, prevEnd };
}

function pctDelta(curVal, prevVal) {
  if (!prevVal || prevVal === 0) return curVal > 0 ? 100 : 0;
  return parseFloat((((curVal - prevVal) / prevVal) * 100).toFixed(1));
}

function nearlyEqual(a, b, eps) {
  return Math.abs((a || 0) - (b || 0)) <= eps;
}

/**
 * Sanity-check API payload: daily buckets should sum to KPI totals where definitions match.
 * @param {object} dashboardData - `dashboardData` object from API (not the full { status, dashboardData } wrapper).
 * @returns {{ ok: boolean, errors: string[] }}
 */
function assertDashboardInvariants(dashboardData) {
  const errors = [];
  if (!dashboardData || typeof dashboardData !== 'object') {
    return { ok: false, errors: ['Missing dashboardData object'] };
  }

  const kpi = dashboardData.kpi || {};
  const daily = (dashboardData.series && dashboardData.series.daily) || [];

  const sum = (key) => daily.reduce((acc, b) => acc + (Number(b[key]) || 0), 0);

  const ordersSum = sum('orders');
  const completedSum = sum('completed');
  const revenueSum = sum('revenue');
  const codExpectedSum = sum('codExpected');
  const codCollectedSum = sum('codCollected');

  if (ordersSum !== (kpi.totalOrders || 0)) {
    errors.push(
      `orders: sum(daily.orders)=${ordersSum} !== kpi.totalOrders=${kpi.totalOrders || 0}`,
    );
  }
  if (completedSum !== (kpi.completedCount || 0)) {
    errors.push(
      `completed: sum(daily.completed)=${completedSum} !== kpi.completedCount=${kpi.completedCount || 0}`,
    );
  }
  if (!nearlyEqual(revenueSum, kpi.revenue || 0, 0.02)) {
    errors.push(
      `revenue: sum(daily.revenue)=${revenueSum} !== kpi.revenue=${kpi.revenue || 0}`,
    );
  }
  if (!nearlyEqual(codExpectedSum, kpi.expectedCash || 0, 0.02)) {
    errors.push(
      `expectedCash: sum(daily.codExpected)=${codExpectedSum} !== kpi.expectedCash=${kpi.expectedCash || 0}`,
    );
  }
  if (!nearlyEqual(codCollectedSum, kpi.collectedCash || 0, 0.02)) {
    errors.push(
      `collectedCash: sum(daily.codCollected)=${codCollectedSum} !== kpi.collectedCash=${kpi.collectedCash || 0}`,
    );
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  DASHBOARD_HEATMAP_TIMEZONE,
  resolveDashboardRange,
  pctDelta,
  assertDashboardInvariants,
};
