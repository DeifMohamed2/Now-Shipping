#!/usr/bin/env node
/**
 * Verify dashboard API payload invariants (sum of daily buckets vs KPIs).
 *
 * Usage:
 *   node scripts/verify-dashboard-invariants.js [path/to/response.json]
 *
 * JSON may be either { "status":"success", "dashboardData": { ... } }
 * or the inner dashboardData object.
 *
 * With no file: runs smoke tests on dashboardMetricHelpers only (exit 0).
 */

const fs = require('fs');
const path = require('path');
const {
  resolveDashboardRange,
  pctDelta,
  assertDashboardInvariants,
} = require('../utils/dashboardMetricHelpers');

function smokeHelpers() {
  const r = resolveDashboardRange('30d');
  if (!(r.start instanceof Date) || !(r.end instanceof Date)) {
    throw new Error('resolveDashboardRange should return Date start/end');
  }
  if (r.end.getTime() < r.start.getTime()) {
    throw new Error('resolveDashboardRange end before start');
  }
  if (pctDelta(10, 5) !== 100) {
    throw new Error(`pctDelta(10,5) expected 100 got ${pctDelta(10, 5)}`);
  }
  if (pctDelta(15, 10) !== 50) {
    throw new Error(`pctDelta(15,10) expected 50 got ${pctDelta(15, 10)}`);
  }
  if (pctDelta(0, 0) !== 0) {
    throw new Error('pctDelta(0,0) expected 0');
  }
  const empty = assertDashboardInvariants(null);
  if (empty.ok || !empty.errors.length) {
    throw new Error('assertDashboardInvariants(null) should fail');
  }
  const good = assertDashboardInvariants({
    kpi: {
      totalOrders: 2,
      completedCount: 1,
      revenue: 100,
      expectedCash: 0,
      collectedCash: 50,
    },
    series: {
      daily: [
        { orders: 1, completed: 1, revenue: 60, codExpected: 0, codCollected: 30 },
        { orders: 1, completed: 0, revenue: 40, codExpected: 0, codCollected: 20 },
      ],
    },
  });
  if (!good.ok) {
    throw new Error(`sample payload should pass: ${good.errors.join('; ')}`);
  }
  console.log('dashboardMetricHelpers smoke: OK');
}

const file = process.argv[2];

if (!file) {
  try {
    smokeHelpers();
    process.exit(0);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}

const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
let raw;
try {
  raw = fs.readFileSync(abs, 'utf8');
} catch (e) {
  console.error('Cannot read file:', abs, e.message);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  console.error('Invalid JSON:', e.message);
  process.exit(1);
}

const payload = parsed.dashboardData != null ? parsed.dashboardData : parsed;

try {
  smokeHelpers();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}

const { ok, errors } = assertDashboardInvariants(payload);
if (!ok) {
  console.error('Invariant failures:');
  errors.forEach((line) => console.error(' -', line));
  process.exit(1);
}

console.log('Dashboard invariants: OK');
