# Business dashboard metrics

Source: [`controllers/businessController.js`](../controllers/businessController.js) (`getDashboardData`), series consumed by [`public/assets/rJS/business/dashboard-analytics.js`](../public/assets/rJS/business/dashboard-analytics.js).

## Scope filter

All KPIs and `series` (except **Recent** tables) use the same order set:

- **Field:** `orderDate`
- **Predicate:** `business === currentUser` and `orderDate` in `[start, end]` inclusive
- **Range:** `resolveDashboardRange()` in [`utils/dashboardMetricHelpers.js`](../utils/dashboardMetricHelpers.js) (`today`, `7d`, `30d`, `90d`, `ytd`, `custom`)

Previous-period deltas use the immediately preceding window of equal length (`prevStart`–`prevEnd`).

## KPIs (`dashboardData.kpi`)

| Key | Definition |
|-----|------------|
| `totalOrders` | Count of orders in scope |
| `completedCount` | `orderStatus === 'completed'` |
| `successRate` | `completedCount / totalOrders` × 100 (period aggregate) |
| `activeCount` | Status in `new`, `inProgress`, `headingToCustomer`, `inStock`, `waitingAction` |
| `returnRate` / `cancelRate` | Counts with statuses per return/cancel buckets in aggregate, divided by `totalOrders` |
| `revenue` | Sum of `feeBreakdown.total` or `orderFees` when status in `completed`, `returnCompleted` |
| `avgOrderValue` | `revenue / revenueOrderCount` where `revenueOrderCount` counts orders with status in `completed`, `returnCompleted` (average **shipping/fee** per delivered order in scope) |
| `expectedCash` | Sum of COD/CD `orderShipping.amount` when status in `headingToCustomer`, `inProgress` |
| `collectedCash` | Sum of COD `orderShipping.amount` when `orderStatus === 'completed'` (same **orderDate** scope; aligns with `sum(series.daily[].codCollected)`) |
| `delta.*` | `pctDelta(current, previous)` for `totalOrders`, `revenue`, `completedCount`, `collectedCash` only. |

## Time series (`series.daily`)

Buckets: `$dateTrunc` on `orderDate` by `day` (≤ ~91 day span) or `month` (longer).

| Field | Meaning |
|-------|---------|
| `orders` | Order count in bucket |
| `completed` / `returned` / `canceled` | Counts by status rules matching KPI buckets |
| `revenue` | Fee sum for completed + returnCompleted in bucket |
| `shippingFees` | Sum of `orderFees` in bucket |
| `codExpected` | Same rule as KPI expected cash, bucketed by `orderDate` |
| `codCollected` | COD amount for **completed** orders in bucket (by `orderDate`) |

**Rate trend chart (client):** For each bucket, `% = metric / orders` (daily mix), not the period-wide `successRate`.

## Other series

- **`series.status`:** Group by `orderStatus` in scope (donut).
- **`series.geo`:** By `orderCustomer.government`; revenue uses same fee rule as KPI revenue.
- **`series.heatmap`:** Count by **local** weekday + hour of `orderDate` using IANA timezone from env **`DASHBOARD_HEATMAP_TZ`** (default **`Africa/Cairo`** in [`utils/dashboardMetricHelpers.js`](../utils/dashboardMetricHelpers.js)).

## Recent lists

Not restricted by dashboard date range:

- **Recent orders:** last 6 by `orderDate` for business
- **Recent pickups:** last 6 by `pickupDate`

## Verification

```bash
node scripts/verify-dashboard-invariants.js path/to/dashboard-response.json
```

Pass a JSON file containing either `{ "dashboardData": { ... } }` or the inner `dashboardData` object. Exit code `1` if invariants fail.

Helpers: `assertDashboardInvariants()` in [`utils/dashboardMetricHelpers.js`](../utils/dashboardMetricHelpers.js).
