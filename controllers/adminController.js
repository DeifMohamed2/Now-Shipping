const mongoose = require('mongoose');
const Order = require('../models/order');
const Courier = require('../models/courier');
const Pickup = require('../models/pickup');
const User = require('../models/user');
const { businessRoleFilter } = require('../utils/businessRoleQuery');
const ShopProduct = require('../models/shopProduct');
const ShopOrder = require('../models/shopOrder');
const ledgerService = require('../utils/ledgerService');
const { getBalance, getBalances } = ledgerService;
const LedgerEntry = require('../models/ledgerEntry');
const Payout = require('../models/payout');
const Ticket = require('../models/ticket');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const statusHelper = require('../utils/statusHelper');
const { emailService } = require('../utils/email');
const firebase = require('../config/firebase');
const JWT_SECRET = process.env.JWT_SECRET;
const ExcelJS = require('exceljs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendSms } = require('../utils/sms');
const {
  canAdminCancel,
  canAdminChangeAddress,
} = require('../utils/orderUiPolicy');
const { DASHBOARD_HEATMAP_TIMEZONE } = require('../utils/dashboardMetricHelpers');
const { applyBusinessLikeCancellation } = require('../utils/orderCancellationFlow');
const {
  resolvePickupAddressForOrder,
  getDefaultPickupAddressId,
} = require('../utils/pickupAddressResolve');
const { generateUniqueOrderNumber } = require('../utils/orderCreationHelper');

/** `range` query: all | today | 7d | 30d | 90d | ytd — filters orders by `orderDate` (inclusive end-of-day). */
function parseAdminDashboardOrderRange(req) {
  const raw = (req.query && (req.query.range || req.query.preset)) || 'all';
  const range = String(raw).toLowerCase();
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (range === 'all') {
    return { range: 'all', match: {}, from: null, to: end };
  }
  let start;
  if (range === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  } else if (range === '7d') {
    start = new Date(now.getTime() - 7 * 86400000);
    start.setHours(0, 0, 0, 0);
  } else if (range === '30d') {
    start = new Date(now.getTime() - 30 * 86400000);
    start.setHours(0, 0, 0, 0);
  } else if (range === '90d') {
    start = new Date(now.getTime() - 90 * 86400000);
    start.setHours(0, 0, 0, 0);
  } else if (range === 'ytd') {
    start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  } else {
    return { range: 'all', match: {}, from: null, to: end };
  }
  return { range, match: { orderDate: { $gte: start, $lte: end } }, from: start, to: end };
}

function recentCreatedRange(from, to) {
  if (!from) return {};
  return { createdAt: { $gte: from, $lte: to } };
}

const RETURN_IN_PROCESS_STATUSES = [
  'returnInitiated',
  'returnAssigned',
  'returnPickedUp',
  'returnAtWarehouse',
  'returnToBusiness',
  'inReturnStock',
];

const ADMIN_ACTIVE_SHIPMENT_STATUSES = [
  'new',
  'pendingPickup',
  'pickedUp',
  'inStock',
  'inProgress',
  'headingToCustomer',
  'headingToYou',
  'waitingAction',
  'rescheduled',
];

const ADMIN_EXCEPTION_ORDER_STATUSES = [
  'deliveryFailed',
  'canceled',
  'terminated',
  'rejected',
];

/** Previous window of equal length ending just before `from` (same wall span as [from, to]). */
function adminPreviousOrderDateMatch(from, to) {
  if (!from || !to) return null;
  const spanMs = to.getTime() - from.getTime();
  const prevEnd = new Date(from.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - spanMs);
  return { orderDate: { $gte: prevStart, $lte: prevEnd } };
}

/** Last 7 calendar days ending on `endDate`'s date in `tz` (YYYY-MM-DD keys, oldest first). */
function last7CalendarDayKeys(endDate, tz) {
  const nf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const endKey = nf.format(endDate);
  const [Y, M, D] = endKey.split('-').map(Number);
  const out = [];
  for (let i = 6; i >= 0; i -= 1) {
    const jd = Date.UTC(Y, M - 1, D - i);
    out.push(nf.format(new Date(jd)));
  }
  return out;
}

function seriesFromDailyAgg(keys, aggRows) {
  const map = {};
  (aggRows || []).forEach((r) => {
    if (r && r._id) map[String(r._id)] = r.c || 0;
  });
  return keys.map((k) => map[k] || 0);
}

function pctChangeVsPrevious(current, previous) {
  if (previous == null || Number.isNaN(previous)) return null;
  if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

const getDashboardPage = (req, res) => {
  res.render('admin/dashboard', {
    title: 'Dashboard',
    page_title: 'Dashboard',
    folder: 'Pages',
  });
};

// Admin Dashboard Data (aggregated)
const getAdminDashboardData = async (req, res) => {
  try {
    const { range, match: orderDateMatch, from, to } = parseAdminDashboardOrderRange(req);
    const orderMatch = Object.keys(orderDateMatch).length ? orderDateMatch : {};
    const statusQuery = (status) => ({ ...orderMatch, orderStatus: status });
    const prevOrderMatch = adminPreviousOrderDateMatch(from, to);
    const courierOrderMatch = Object.keys(orderDateMatch).length
      ? { ...orderDateMatch, deliveryMan: { $ne: null } }
      : {
          createdAt: {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
          deliveryMan: { $ne: null },
        };

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [
      totalOrders,
      completedCount,
      headingToCustomerCount,
      newOrdersCount,
      headingToYouCount,
      awaitingActionCount,
      pickedUpCount,
      inProgressCount,
      activeShipmentsCount,
      exceptionsCountInRange,
      recentOrders,
      recentPickups,
      activeCouriers,
      onlineCouriers,
      ordersByStatus,
      ordersByCategory,
      ordersByGovernment,
      revenueByMonth,
      amountTypeBreakdown,
      expressBreakdown,
      courierAssignments30d,
      returnRateMonthly,
      ordersByMonth,
      returnInProcess,
      returnCompletedCount,
      failedDeliveriesCount,
      openTicketsCount,
      cancellationsToday,
      avgDeliveryAgg,
      pickupByStatus,
      shopByStatus,
      businessAggRaw,
      maxRevenueRow,
      problemOrdersBad,
      heatmapRaw,
    ] = await Promise.all([
      Order.countDocuments(orderMatch),
      Order.countDocuments(statusQuery('completed')),
      Order.countDocuments(statusQuery('headingToCustomer')),
      Order.countDocuments(statusQuery('new')),
      Order.countDocuments(statusQuery('headingToYou')),
      Order.countDocuments({
        ...orderMatch,
        orderStatus: { $in: ['waitingAction', 'rescheduled'] },
      }),
      Order.countDocuments(statusQuery('pickedUp')),
      Order.countDocuments(statusQuery('inProgress')),
      Order.countDocuments({
        ...orderMatch,
        orderStatus: { $in: ADMIN_ACTIVE_SHIPMENT_STATUSES },
      }),
      Order.countDocuments({
        ...orderMatch,
        orderStatus: { $in: ADMIN_EXCEPTION_ORDER_STATUSES },
      }),
      Order.find(recentCreatedRange(from, to))
        .select('orderNumber orderStatus orderBusiness business createdAt')
        .populate('business', 'name brandInfo.brandName')
        .sort({ createdAt: -1 })
        .limit(7)
        .lean(),
      Pickup.find(from ? recentCreatedRange(from, to) : {})
        .select('pickupNumber pickupDate numberOfOrders picikupStatus createdAt')
        .sort({ createdAt: -1 })
        .limit(7)
        .lean(),
      Courier.countDocuments({ isActive: true }),
      Courier.countDocuments({ isOnline: true }).catch(() => 0),
      Order.aggregate([
        { $match: orderMatch },
        { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        { $group: { _id: '$statusCategory', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        { $group: { _id: '$orderCustomer.government', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      Order.aggregate([
        {
          $match: {
            ...orderMatch,
            orderStatus: { $in: ['completed', 'returnCompleted'] },
          },
        },
        {
          $project: {
            m: { $month: { $ifNull: ['$completedDate', '$updatedAt'] } },
            y: { $year: { $ifNull: ['$completedDate', '$updatedAt'] } },
            amount: { $ifNull: ['$feeBreakdown.total', '$orderFees'] },
          },
        },
        { $group: { _id: { y: '$y', m: '$m' }, revenue: { $sum: '$amount' }, orders: { $sum: 1 } } },
        { $sort: { '_id.y': -1, '_id.m': -1 } },
        { $limit: 12 },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        { $group: { _id: '$orderShipping.amountType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        {
          $group: {
            _id: { $ifNull: ['$orderShipping.isExpressShipping', false] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Order.aggregate([
        { $match: courierOrderMatch },
        { $group: { _id: '$deliveryMan', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'couriers',
            localField: '_id',
            foreignField: '_id',
            as: 'courierDoc',
          },
        },
        {
          $project: {
            count: 1,
            courierName: { $arrayElemAt: ['$courierDoc.courierName', 0] },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            ...orderMatch,
            orderStatus: { $in: ['returned', 'returnCompleted', 'deliveryFailed'] },
          },
        },
        {
          $project: {
            m: { $month: { $ifNull: ['$updatedAt', '$orderDate'] } },
            y: { $year: { $ifNull: ['$updatedAt', '$orderDate'] } },
          },
        },
        { $group: { _id: { y: '$y', m: '$m' }, count: { $sum: 1 } } },
        { $sort: { '_id.y': -1, '_id.m': -1 } },
        { $limit: 9 },
      ]),
      Order.aggregate([
        { $match: orderMatch },
        { $project: { m: { $month: '$orderDate' }, y: { $year: '$orderDate' } } },
        { $group: { _id: { y: '$y', m: '$m' }, count: { $sum: 1 } } },
        { $sort: { '_id.y': -1, '_id.m': -1 } },
        { $limit: 12 },
      ]),
      Order.countDocuments({
        ...orderMatch,
        orderStatus: { $in: RETURN_IN_PROCESS_STATUSES },
      }),
      Order.countDocuments({ ...orderMatch, orderStatus: 'returnCompleted' }),
      Order.countDocuments({ ...orderMatch, orderStatus: 'deliveryFailed' }),
      Ticket.countDocuments({
        status: { $in: ['new', 'open', 'pending', 'in_progress', 'reopened'] },
      }),
      Order.countDocuments({
        orderStatus: 'canceled',
        updatedAt: { $gte: startOfToday, $lte: endOfToday },
      }),
      Order.aggregate([
        {
          $match: {
            ...orderMatch,
            orderStatus: 'completed',
            completedDate: { $exists: true, $ne: null },
            orderDate: { $exists: true, $ne: null },
          },
        },
        {
          $project: {
            days: {
              $divide: [{ $subtract: ['$completedDate', '$orderDate'] }, 86400000],
            },
          },
        },
        { $group: { _id: null, avg: { $avg: '$days' } } },
      ]),
      Pickup.aggregate([
        ...(from
          ? [{ $match: { createdAt: { $gte: from, $lte: to } } }]
          : []),
        { $group: { _id: '$picikupStatus', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ShopOrder.aggregate([
        ...(from
          ? [{ $match: { createdAt: { $gte: from, $lte: to } } }]
          : []),
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Order.aggregate([
        { $match: { ...orderMatch, business: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: '$business',
            totalOrders: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'completed'] }, 1, 0] },
            },
            revenue: {
              $sum: {
                $cond: [
                  { $eq: ['$orderStatus', 'completed'] },
                  { $ifNull: ['$feeBreakdown.total', '$orderFees'] },
                  0,
                ],
              },
            },
            bad: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      '$orderStatus',
                      ['canceled', 'returned', 'terminated', 'deliveryFailed', 'rejected'],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $match: { totalOrders: { $gte: 1 } } },
      ]),
      Order.aggregate([
        { $match: { ...orderMatch, orderStatus: 'completed' } },
        {
          $group: {
            _id: null,
            maxRev: { $max: { $ifNull: ['$feeBreakdown.total', '$orderFees'] } },
          },
        },
      ]),
      Order.countDocuments({
        ...orderMatch,
        orderStatus: {
          $in: ['canceled', 'returned', 'terminated', 'deliveryFailed', 'rejected'],
        },
      }),
      Order.aggregate([
        { $match: orderMatch },
        {
          $group: {
            _id: {
              dow: {
                $dayOfWeek: {
                  date: '$orderDate',
                  timezone: DASHBOARD_HEATMAP_TIMEZONE,
                },
              },
              hour: {
                $hour: {
                  date: '$orderDate',
                  timezone: DASHBOARD_HEATMAP_TIMEZONE,
                },
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const avgDeliveryDays =
      avgDeliveryAgg && avgDeliveryAgg[0] && avgDeliveryAgg[0].avg != null
        ? Math.round(avgDeliveryAgg[0].avg * 10) / 10
        : null;

    const completionRate =
      totalOrders > 0 ? Math.round((completedCount / totalOrders) * 100) : 0;
    const badRate =
      totalOrders > 0 ? (problemOrdersBad || 0) / totalOrders : 0;

    const maxRev =
      maxRevenueRow && maxRevenueRow[0] && maxRevenueRow[0].maxRev != null
        ? maxRevenueRow[0].maxRev
        : 0;
    const maxRevSafe = Math.max(1, maxRev);

    function scoreRow(r) {
      const t = r.totalOrders || 1;
      const compPct = (r.completed || 0) / t;
      const badPct = (r.bad || 0) / t;
      const revNorm =
        Math.log10(1 + (r.revenue || 0)) / Math.log10(1 + maxRevSafe);
      const boundedRev = Math.min(1, Math.max(0, revNorm));
      const raw = compPct * 55 + boundedRev * 35 - badPct * 40;
      return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
    }

    const enriched = (businessAggRaw || []).map((r) => {
      const total = r.totalOrders || 0;
      const completed = r.completed || 0;
      const successPct =
        total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
      return {
        businessId: r._id,
        totalOrders: total,
        completed,
        revenue: Math.round((r.revenue || 0) * 100) / 100,
        bad: r.bad,
        completionRate: successPct,
        successRatePercent: successPct,
        badRate: total > 0 ? Math.round((r.bad / total) * 1000) / 10 : 0,
        score: scoreRow(r),
      };
    });

    const MIN_FOR_LEADERBOARD = 5;
    const MIN_FOR_TABLE = 1;
    const qualified = enriched.filter((b) => b.totalOrders >= MIN_FOR_LEADERBOARD);
    const forTable = enriched.filter((b) => b.totalOrders >= MIN_FOR_TABLE);
    const sortedDesc = [...qualified].sort((a, b) => b.score - a.score);
    const sortedAsc = [...qualified].sort((a, b) => a.score - b.score);
    const sortedTable = [...forTable].sort((a, b) => b.score - a.score);
    const topSlice = sortedDesc.slice(0, 10);
    const bottomSlice = sortedAsc.slice(0, 10);
    const topTableSlice = sortedTable.slice(0, 25).map((b, idx) => ({
      ...b,
      rank: idx + 1,
    }));

    const ids = [
      ...new Set(
        [...topSlice, ...bottomSlice, ...topTableSlice].map((x) =>
          String(x.businessId)
        )
      ),
    ];
    const idObjs = ids.filter(Boolean).map((id) => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    const users =
      idObjs.length > 0
        ? await User.find({ _id: { $in: idObjs } })
            .select('name brandInfo.brandName')
            .lean()
        : [];
    const nameMap = {};
    users.forEach((u) => {
      nameMap[String(u._id)] =
        u.brandInfo?.brandName || u.name || 'Business';
    });

    const attachNames = (arr) =>
      arr.map((b) => ({
        ...b,
        businessName: nameMap[String(b.businessId)] || 'Business',
      }));

    const topBusinesses = attachNames(topSlice);
    const bottomBusinesses = attachNames(bottomSlice);
    const topBusinessesTable = attachNames(topTableSlice);

    const heatmap = (heatmapRaw || []).map((h) => ({
      dow: h._id.dow,
      hour: h._id.hour,
      count: h.count,
    }));

    const tzHeat = DASHBOARD_HEATMAP_TIMEZONE;
    const sparkKeys = last7CalendarDayKeys(to, tzHeat);
    const sparkEnd = to;
    const sixDaysBefore = new Date(sparkEnd);
    sixDaysBefore.setDate(sixDaysBefore.getDate() - 6);
    sixDaysBefore.setHours(0, 0, 0, 0);
    const sparkLow =
      from && from.getTime() > sixDaysBefore.getTime() ? from : sixDaysBefore;
    const sparkOrderMatch = {
      ...orderMatch,
      orderDate: { $gte: sparkLow, $lte: sparkEnd },
    };
    const dailyOrderBucket = {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$orderDate',
            timezone: tzHeat,
          },
        },
        c: { $sum: 1 },
      },
    };
    const sparkAggBundles = await Promise.all([
      Order.aggregate([
        { $match: sparkOrderMatch },
        dailyOrderBucket,
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        {
          $match: {
            ...sparkOrderMatch,
            orderStatus: { $in: RETURN_IN_PROCESS_STATUSES },
          },
        },
        dailyOrderBucket,
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        {
          $match: {
            ...sparkOrderMatch,
            orderStatus: { $in: ADMIN_EXCEPTION_ORDER_STATUSES },
          },
        },
        dailyOrderBucket,
        { $sort: { _id: 1 } },
      ]),
    ]);
    const sparkOrdersByDay = sparkAggBundles[0];
    const sparkReturnsByDay = sparkAggBundles[1];
    const sparkExceptionsByDay = sparkAggBundles[2];

    let prevTotals = null;
    if (prevOrderMatch) {
      const pm = prevOrderMatch;
      const [
        pTotal,
        pActive,
        pCompleted,
        pInTransit,
        pReturns,
        pExceptions,
      ] = await Promise.all([
        Order.countDocuments(pm),
        Order.countDocuments({
          ...pm,
          orderStatus: { $in: ADMIN_ACTIVE_SHIPMENT_STATUSES },
        }),
        Order.countDocuments({ ...pm, orderStatus: 'completed' }),
        Order.countDocuments({
          ...pm,
          orderStatus: {
            $in: ['headingToCustomer', 'pickedUp', 'inProgress'],
          },
        }),
        Order.countDocuments({
          ...pm,
          orderStatus: { $in: RETURN_IN_PROCESS_STATUSES },
        }),
        Order.countDocuments({
          ...pm,
          orderStatus: { $in: ADMIN_EXCEPTION_ORDER_STATUSES },
        }),
      ]);
      prevTotals = {
        totalOrders: pTotal,
        activeShipments: pActive,
        delivered: pCompleted,
        inTransit: pInTransit,
        returns: pReturns,
        exceptions: pExceptions,
      };
    }

    const inTransitCount =
      (headingToCustomerCount || 0) +
      (pickedUpCount || 0) +
      (inProgressCount || 0);

    const sparklineOrders7d = seriesFromDailyAgg(sparkKeys, sparkOrdersByDay);
    const sparklineReturns7d = seriesFromDailyAgg(sparkKeys, sparkReturnsByDay);
    const sparklineExceptions7d = seriesFromDailyAgg(
      sparkKeys,
      sparkExceptionsByDay
    );

    const kpiDeltas = prevTotals
      ? {
          totalOrders: pctChangeVsPrevious(totalOrders, prevTotals.totalOrders),
          activeShipments: pctChangeVsPrevious(
            activeShipmentsCount,
            prevTotals.activeShipments
          ),
          delivered: pctChangeVsPrevious(completedCount, prevTotals.delivered),
          inTransit: pctChangeVsPrevious(inTransitCount, prevTotals.inTransit),
          returns: pctChangeVsPrevious(returnInProcess, prevTotals.returns),
          exceptions: pctChangeVsPrevious(
            exceptionsCountInRange,
            prevTotals.exceptions
          ),
        }
      : {
          totalOrders: null,
          activeShipments: null,
          delivered: null,
          inTransit: null,
          returns: null,
          exceptions: null,
        };

    const recentOrdersOut = (recentOrders || []).map((o) => ({
      orderNumber: o.orderNumber,
      orderStatus: o.orderStatus,
      createdAt: o.createdAt,
      businessName:
        o.business?.brandInfo?.brandName ||
        o.business?.name ||
        o.orderBusiness?.name ||
        null,
    }));

    const dashboardData = {
      meta: {
        range,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        heatmapTimezone: tzHeat,
        courierLoadNote: Object.keys(orderDateMatch).length
          ? 'Assignments in the selected order date range.'
          : 'Assignments in the last 30 days (all-time has no order date filter).',
        rangeLabelHuman: from
          ? `${from.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })} – ${to.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}`
          : 'All time',
        scoreNote:
          'Score = completion×55 + log-scaled revenue×35 − bad-order rate×40 (0–100, businesses with 5+ orders in range).',
      },
      orderStats: {
        totalOrders,
        completedCount,
        completionRate,
        headingToCustomerCount,
        newOrdersCount,
        headingToYouCount,
        awaitingActionCount,
        pickedUpCount,
        inProgressCount,
        inTransitCount,
        activeShipmentsCount,
        exceptionsCountInRange,
      },
      recentData: {
        recentOrders: recentOrdersOut,
        recentPickups: (recentPickups || []).map((p) => ({
          pickupNumber: p.pickupNumber,
          pickupDate: p.pickupDate,
          picikupStatus: p.picikupStatus,
          pickupStatus: p.picikupStatus,
        })),
      },
      kpiSparklines: {
        orders7d: sparklineOrders7d,
        returns7d: sparklineReturns7d,
        exceptions7d: sparklineExceptions7d,
        dayKeys: sparkKeys,
      },
      kpiDeltas,
      financialStats: {
        totalRevenue: Array.isArray(revenueByMonth)
          ? revenueByMonth.reduce((s, r) => s + (r.revenue || 0), 0)
          : 0,
        revenueByMonth,
        ordersByMonth,
      },
      courierStats: {
        active: activeCouriers || 0,
        online: onlineCouriers || 0,
        assignments30d: courierAssignments30d,
      },
      slaStats: {
        avgDeliveryDays: avgDeliveryDays != null ? avgDeliveryDays : null,
      },
      issueStats: {
        open: openTicketsCount || 0,
        cancellationsToday: cancellationsToday || 0,
      },
      returnStats: {
        inProcess: returnInProcess || 0,
        completed: returnCompletedCount || 0,
        failedDeliveries: failedDeliveriesCount || 0,
        monthly: returnRateMonthly,
      },
      breakdowns: {
        byStatus: ordersByStatus,
        byCategory: ordersByCategory,
        byGovernment: ordersByGovernment,
        amountType: amountTypeBreakdown,
        express: expressBreakdown,
      },
      pickupBreakdown: pickupByStatus,
      shopBreakdown: shopByStatus,
      businessPerformance: {
        topBusinesses,
        bottomBusinesses,
        topBusinessesTable,
        minOrdersForRanking: MIN_FOR_LEADERBOARD,
        minOrdersForTable: MIN_FOR_TABLE,
      },
      heatmap,
    };

    res.status(200).json({ status: 'success', dashboardData });
  } catch (error) {
    console.error('Error loading admin dashboard data:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load dashboard data' });
  }
};

// ======================================== Orders Page ======================================== //

const get_ordersPage = (req, res) => {
  res.render('admin/orders', {
    title: 'Orders',
    page_title: 'Orders',
    folder: 'Pages',
  });
};

const get_ordersFilterBusinesses = async (req, res) => {
  try {
    const raw = (req.query.q || '').trim();
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mongoQuery = { ...businessRoleFilter(), isCompleted: true };
    if (raw) {
      const searchRegex = new RegExp(escapeRegex(raw), 'i');
      mongoQuery.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phoneNumber: searchRegex },
        { 'brandInfo.brandName': searchRegex },
        { 'brandInfo.industry': searchRegex },
      ];
    }
    const users = await User.find(mongoQuery)
      .select('_id name email brandInfo.brandName')
      .sort({ 'brandInfo.brandName': 1, name: 1 })
      .limit(30)
      .lean();

    const businesses = users.map((u) => ({
      id: u._id.toString(),
      label: u.brandInfo?.brandName || u.name || u.email || 'Business',
    }));
    res.status(200).json({ businesses });
  } catch (error) {
    console.error('Error in orders filter businesses:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const get_orders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      orderType,
      status,
      statusCategory,
      paymentType,
      dateFrom,
      dateTo,
      search,
      businessId,
    } = req.query;

    const query = {};

    if (businessId && mongoose.Types.ObjectId.isValid(businessId)) {
      query.business = new mongoose.Types.ObjectId(businessId);
    }

    if (orderType && statusHelper.ORDER_TYPES[orderType]) {
      query['orderShipping.orderType'] = orderType;
    }

    if (status && status !== 'all') {
      query.orderStatus = status;
    }

    if (statusCategory && statusHelper.STATUS_CATEGORIES[statusCategory]) {
      query.statusCategory = statusCategory;
    }

    if (paymentType && paymentType !== 'all') {
      query['orderShipping.amountType'] = paymentType;
    }

    if (dateFrom || dateTo) {
      query.orderDate = {};
      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        query.orderDate.$gte = fromDate;
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        query.orderDate.$lte = toDate;
      }
    }

    if (search && search.trim() !== '') {
      const trimmed = search.trim();
      const searchRegex = new RegExp(
        trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      );
      const searchOr = [
        { orderNumber: searchRegex },
        { 'orderCustomer.fullName': searchRegex },
        { 'orderCustomer.phoneNumber': searchRegex },
        { 'orderShipping.productDescription': searchRegex },
      ];
      const businessUsers = await User.find({
        ...businessRoleFilter(),
        isCompleted: true,
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { phoneNumber: searchRegex },
          { 'brandInfo.brandName': searchRegex },
          { 'brandInfo.industry': searchRegex },
        ],
      })
        .select('_id')
        .lean();
      const bizIds = businessUsers.map((u) => u._id);
      if (bizIds.length) {
        searchOr.push({ business: { $in: bizIds } });
      }
      query.$or = searchOr;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find(query)
      .populate('business', 'brandInfo')
      .populate('deliveryMan')
      .sort({ orderDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await Order.countDocuments(query);

    const enhancedOrders = orders.map((order) => {
      const orderObj = order.toObject();
      orderObj.statusLabel = statusHelper.getOrderStatusLabel(
        order.orderStatus
      );
      orderObj.statusDescription = statusHelper.getOrderStatusDescription(
        order.orderStatus
      );
      orderObj.categoryClass = statusHelper.getCategoryClass(
        order.statusCategory
      );
      orderObj.categoryColor = statusHelper.getCategoryColor(
        order.statusCategory
      );
      orderObj.nextPossibleStatuses = statusHelper.getNextPossibleStatuses(
        order.orderStatus
      );
      orderObj.isFastShipping =
        order.orderShipping && order.orderShipping.isExpressShipping;
      if (orderObj.isFastShipping) {
        orderObj.readyForCourierAssignment = order.orderStatus === 'new';
      }
      if (order.orderShipping && order.orderShipping.orderType === 'Exchange') {
        orderObj.isExchange = true;
        orderObj.exchangeDetails = {
          originalProduct: order.orderShipping.productDescription,
          originalCount: order.orderShipping.numberOfItems,
          replacementProduct: order.orderShipping.productDescriptionReplacement,
          replacementCount: order.orderShipping.numberOfItemsReplacement,
        };
      }
      return orderObj;
    });

    res.status(200).json({
      orders: enhancedOrders || [],
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + orders.length < totalCount,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error('Error in orders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const get_orderDetailsPage = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const order = await Order.findOne({ orderNumber: orderNumber })
      .populate('business')
      .populate('deliveryMan')
      .populate({
        path: 'courierHistory.courier',
        model: 'courier',
        select: 'name',
      });

    if (!order) {
      req.flash('error', 'Order not found');
      return res.redirect('/admin/orders');
    }

    const { address: selectedPickupAddress } = resolvePickupAddressForOrder(
      order,
      order.business
    );

    const trackingDisplay =
      order.smartFlyerBarcode || order.referralNumber || '';
    const rawHist = Array.isArray(order.orderStatusHistory)
      ? order.orderStatusHistory
      : [];
    const statusHistoryChronological = rawHist
      .slice()
      .sort(
        (a, b) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
      )
      .map((h) => {
        const o = typeof h.toObject === 'function' ? h.toObject() : h;
        return {
          status: o.status,
          date: o.date,
          category: o.category,
          notes: o.notes,
          reason: o.reason,
          label: statusHelper.getOrderStatusLabel(o.status),
        };
      });

    res.render('admin/order-details', {
      title: 'Order Details',
      page_title: 'Order Details',
      folder: 'Orders',
      order: order,
      selectedPickupAddress: selectedPickupAddress,
      canCancelOrder: canAdminCancel(order),
      canChangeAddress: canAdminChangeAddress(order),
      trackingDisplay,
      statusHistoryChronological,
      orderStatusLabel: statusHelper.getOrderStatusLabel(order.orderStatus),
    });
  } catch (error) {
    console.log(error);
    req.flash('error', 'Internal Server Error');
    res.redirect('/admin/orders');
  }
};

/**
 * Match couriers whose assignedZones list covers order zone labels.
 * Order zones may be short (e.g. "ElBasatin") while courier zones are
 * long (e.g. "ElMaadi - ElGezira (ElBasatin)"); exact equality failed before.
 * @param {string|string[]|undefined} zoneParam - one zone or Express `req.query.zone` (string or array)
 * @returns {object|null} Mongo filter or null if no zones
 */
function courierAssignedZonesMatchQuery(zoneParam) {
  const raw = zoneParam == null ? [] : Array.isArray(zoneParam) ? zoneParam : [zoneParam];
  const zones = raw.map((z) => (z != null ? String(z).trim() : '')).filter(Boolean);
  if (zones.length === 0) return null;

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const oneZone = (z) => ({
    $or: [
      { assignedZones: z },
      { assignedZones: { $regex: escapeRegex(z), $options: 'i' } },
    ],
  });

  return zones.length === 1 ? oneZone(zones[0]) : { $and: zones.map(oneZone) };
}

const get_deliveryMenByZone = async (req, res) => {
  const { zone } = req.query;
  try {
    const zoneQuery = courierAssignedZonesMatchQuery(zone);
    if (!zoneQuery) {
      return res.status(200).json([]);
    }
    const deliveryMen = await Courier.find({
      $and: [zoneQuery, { isAvailable: true }],
    });
    res.status(200).json(deliveryMen);
  } catch (error) {
    console.error('Error fetching delivery men:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// ========================================End Orders ======================================== //

const get_couriersPage = (req, res) => {
  res.render('admin/couriers', {
    title: 'Couriers',
    page_title: 'Couriers',
    folder: 'Pages',
  });
};

const get_couriers = async (req, res) => {
  const { status } = req.query;
  let couriers = [];

  try {
    // Get base courier query based on status
    let courierQuery;
    if (status === 'active') {
      courierQuery = Courier.find({ isAvailable: true });
    } else if (status === 'inactive') {
      courierQuery = Courier.find({ isAvailable: false });
    } else {
      courierQuery = Courier.find({});
    }

    // Get couriers
    couriers = await courierQuery;

    // Get additional stats for each courier
    let courierStats = await Promise.all(
      couriers.map(async (courier) => {
        // Get completed and cancelled/rejected orders
        const completedOrders = await Order.countDocuments({
          deliveryMan: courier._id,
          orderStatus: 'completed',
        });

        const cancelledOrders = await Order.countDocuments({
          deliveryMan: courier._id,
          orderStatus: { $in: ['canceled', 'rejected'] },
        });

        // Calculate success percentage
        const totalOrders = completedOrders + cancelledOrders;
        const successPercentage =
          totalOrders > 0
            ? Math.round((completedOrders / totalOrders) * 100)
            : 0;

        // Get active orders
        const activeOrders = await Order.countDocuments({
          deliveryMan: courier._id,
          orderStatus: { $in: ['headingToCustomer', 'headingToYou'] },
        });

        // Get active pickups
        const activePickups = await Pickup.countDocuments({
          assignedDriver: courier._id,
          picikupStatus: 'pickedUp',
        });

        // Get total assigned orders
        const totalAssignedOrders = await Order.countDocuments({
          deliveryMan: courier._id,
        });

        // Get total assigned pickups
        const totalAssignedPickups = await Pickup.countDocuments({
          assignedDriver: courier._id,
        });

        return {
          ...courier.toObject(),
          successPercentage,
          activeOrders,
          activePickups,
          totalAssignedOrders,
          totalAssignedPickups,
        };
      })
    );

    // Sort couriers by success percentage in descending order
    courierStats.sort((a, b) => b.successPercentage - a.successPercentage);

    res.status(200).json(courierStats || []);
  } catch (error) {
    console.error('Error in couriers:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const createCourier = async (req, res) => {
  const {
    fullName,
    personalEmail,
    phoneNumber,
    nationalId,
    dateOfBirth,
    vehicleType,
    vehiclePlateNumber,
    email,
    password,
    address,
    photo,
    zones,
    allPapers,
  } = req.body;
  try {
    console.log(req.body);
    if (
      !fullName ||
      !phoneNumber ||
      !nationalId ||
      !dateOfBirth ||
      !vehicleType ||
      !vehiclePlateNumber ||
      !email ||
      !password ||
      !address ||
      !photo
    ) {
      return res.status(400).json({
        status: 'error',
        error: 'Please fill all the fields',
      });
    }

    const [phoneInUser, phoneInCourier] = await Promise.all([
      User.findOne({ phoneNumber }),
      Courier.findOne({ phoneNumber }),
    ]);
    if (phoneInUser || phoneInCourier) {
      return res.status(400).json({
        status: 'error',
        error:
          'This phone number is already used by an existing account. Please use a different number.',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const courier = new Courier({
      courierID: String(Math.floor(10000 + Math.random() * 90000)),
      name: fullName,
      personalPhoto: photo,
      personalEmail,
      phoneNumber,
      nationalId,
      dateOfBirth,
      vehicleType,
      vehiclePlateNumber,
      email,
      password: hashedPassword,
      address,
      assignedZones: zones,
      allPapers: Array.isArray(allPapers) ? allPapers : [],
    });

    courier
      .save()
      .then((courier) => {
        res.status(201).json({
          status: 'success',
          courier: {
            id: courier._id,
            name: courier.name,
            email: courier.email,
            role: courier.role,
          },
        });
      })
      .catch((err) => {
        console.log(err);
        if (err.code === 11000) {
          const k = err.keyValue && Object.keys(err.keyValue)[0];
          let msg =
            'It looks like a courier with this email or national ID already exists. Please use a different email or national ID.';
          if (k === 'phoneNumber') {
            msg =
              'This phone number is already used by an existing account. Please use a different number.';
          }
          res.status(400).json({
            status: 'error',
            error: msg,
          });
        } else if (err.name === 'ValidationError') {
          res.status(400).json({
            status: 'error',
            error: 'Validation error: ' + err.message,
          });
        } else {
          res.status(500).json({
            status: 'error',
            error: 'An internal server error occurred. Please try again.',
          });
        }
      });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      status: 'error',
      error: 'An error occurred',
    });
  }
};

/** Bulk set couriers unavailable (by courierID strings). */
const bulkDeactivateCouriers = async (req, res) => {
  const { courierIDs } = req.body;
  if (!courierIDs || !Array.isArray(courierIDs) || courierIDs.length === 0) {
    return res.status(400).json({ error: 'courierIDs array is required' });
  }
  try {
    const result = await Courier.updateMany(
      { courierID: { $in: courierIDs } },
      { $set: { isAvailable: false } }
    );
    return res.status(200).json({
      message: 'Couriers updated',
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error('bulkDeactivateCouriers:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/** Delete couriers that have no current assignments (assigned* arrays empty). */
const bulkDeleteCouriers = async (req, res) => {
  const { courierIDs } = req.body;
  if (!courierIDs || !Array.isArray(courierIDs) || courierIDs.length === 0) {
    return res.status(400).json({ error: 'courierIDs array is required' });
  }
  const deleted = [];
  const skipped = [];
  try {
    for (const courierID of courierIDs) {
      const c = await Courier.findOne({ courierID: String(courierID) });
      if (!c) {
        skipped.push({ courierID, reason: 'not_found' });
        continue;
      }
      const hasAssigned =
        (c.assignedOrders && c.assignedOrders.length > 0) ||
        (c.assignedPickups && c.assignedPickups.length > 0) ||
        (c.assignedShopOrders && c.assignedShopOrders.length > 0);
      if (hasAssigned) {
        skipped.push({ courierID, reason: 'has_active_assignments' });
        continue;
      }
      await Courier.findOneAndDelete({ courierID: String(courierID) });
      deleted.push(courierID);
    }
    return res.status(200).json({ deleted, skipped });
  } catch (error) {
    console.error('bulkDeleteCouriers:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Update courier zones
const updateCourierZones = async (req, res) => {
  const { courierId, zones, notes } = req.body;

  try {
    // Validate input
    if (!courierId || !zones || !Array.isArray(zones) || zones.length === 0) {
      return res.status(400).json({
        status: 'error',
        error: 'Courier ID and at least one zone are required',
      });
    }

    // Find the courier
    const courier = await Courier.findOne({ courierID: courierId });

    if (!courier) {
      return res.status(404).json({
        status: 'error',
        error: 'Courier not found',
      });
    }

    // Update assigned zones
    courier.assignedZones = zones;
    await courier.save();

    res.status(200).json({
      status: 'success',
      message: 'Zones updated successfully',
      data: {
        courierID: courier.courierID,
        name: courier.name,
        assignedZones: courier.assignedZones,
      },
    });
  } catch (err) {
    console.error('Error updating courier zones:', err);
    res.status(500).json({
      status: 'error',
      error: 'An error occurred while updating zones',
    });
  }
};

// ========================================= Couriers Follow Up Page ======================================== //

const get_couriersFollowUp = async (req, res) => {
  try {
    // Get all couriers
    const couriers = await Courier.find({});

    // Prepare courier statistics
    const courierStats = await Promise.all(
      couriers.map(async (courier) => {
        // Get money with courier
        const moneyWithCourier = await Order.aggregate([
          {
            $match: {
              deliveryMan: courier._id,
              isMoneyRecivedFromCourier: false,
              orderStatus: { $in: ['completed', 'headingToCustomer'] },
              'orderShipping.orderType': { $ne: 'Return' },
              'orderShipping.amountType': { $in: ['COD', 'CD'] }, // Cash on Delivery, Cash Difference
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$orderShipping.amount' },
            },
          },
        ]);

        // Get orders to return count
        const ordersToReturn = await Order.countDocuments({
          deliveryMan: courier._id,
          orderStatus: { $in: ['returnToWarehouse', 'waitingAction'] },
        });

        // Get active orders count
        const activeOrders = await Order.countDocuments({
          deliveryMan: courier._id,
          orderStatus: {
            $in: ['headingToCustomer', 'headingToYou', 'inProgress'],
          },
        });

        // Calculate performance based on completed orders today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const completedToday = await Order.countDocuments({
          deliveryMan: courier._id,
          orderStatus: 'completed',
          completedDate: { $gte: today },
        });

        // Assuming each courier has a daily target of 10 orders
        const dailyTarget = 10;
        const performance = Math.min(100, (completedToday / dailyTarget) * 100);

        // Get assigned zones
        const zones = courier.assignedZones || [];

        // Determine courier status badge
        let statusBadge = 'bg-success-subtle text-success';
        let statusText = 'Active';

        if (!courier.isAvailable) {
          statusBadge = 'bg-danger-subtle text-danger';
          statusText = 'Inactive';
        } else if (courier.onLeave) {
          statusBadge = 'bg-warning-subtle text-warning';
          statusText = 'On Leave';
        }

        return {
          id: courier._id,
          courierId: courier.courierID,
          name: courier.name,
          photo: courier.personalPhoto || '/placeholder.svg?height=70&width=70',
          status: statusText,
          statusBadge: statusBadge,
          moneyWithCourier: moneyWithCourier[0]?.total || 0,
          ordersToReturn: ordersToReturn,
          activeOrders: activeOrders,
          zones: zones,
          performance: performance,
        };
      })
    );

    // Calculate summary statistics
    const activeCouriersCount = couriers.filter(
      (c) => c.isAvailable && !c.onLeave
    ).length;
    const totalMoneyWithCouriers = courierStats.reduce(
      (sum, courier) => sum + courier.moneyWithCourier,
      0
    );
    const totalOrdersToReturn = courierStats.reduce(
      (sum, courier) => sum + courier.ordersToReturn,
      0
    );
    const totalActiveDeliveries = courierStats.reduce(
      (sum, courier) => sum + courier.activeOrders,
      0
    );

    console.log('active couriers count:', activeCouriersCount);
    console.log('total money with couriers:', totalMoneyWithCouriers);
    console.log('total orders to return:', totalOrdersToReturn);
    console.log('total active deliveries:', totalActiveDeliveries);

    console.log('courier stats:', courierStats);

    res.render('admin/couriers-follow-up', {
      title: 'Couriers Follow Up',
      page_title: 'Couriers Follow Up',
      folder: 'Pages',
      summaryStats: {
        activeCouriersCount,
        totalMoneyWithCouriers,
        totalOrdersToReturn,
        totalActiveDeliveries,
      },
      couriers: courierStats,
    });
  } catch (error) {
    console.error('Error in get_couriersFollowUp:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const get_courierDetailsPage = async (req, res) => {
  const { courierId } = req.params;
  try {
    const courier = await Courier.findOne({ courierID: courierId });

    if (!courier) {
      return res.render('admin/courier-details', {
        title: 'Courier Details',
        page_title: 'Courier Details',
        folder: 'Pages',
        courier: null,
      });
    }

    // Fetch additional stats for the courier
    const moneyWithCourier = await Order.aggregate([
      {
        $match: {
          deliveryMan: courier._id,
          isMoneyRecivedFromCourier: false,

          orderStatus: { $in: ['completed', 'headingToCustomer'] },
          'orderShipping.orderType': { $ne: 'Return' },

          'orderShipping.amountType': { $in: ['COD', 'CD'] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$orderShipping.amount' },
        },
      },
    ]);

    const ordersToReturn = await Order.countDocuments({
      deliveryMan: courier._id,
      orderStatus: { $in: ['returnToWarehouse', 'waitingAction'] },
    });

    const activeOrders = await Order.countDocuments({
      deliveryMan: courier._id,
      orderStatus: { $in: ['headingToCustomer', 'headingToYou', 'inProgress'] },
    });

    const totalDeliveries = await Order.countDocuments({
      deliveryMan: courier._id,
    });

    const completedOrders = await Order.countDocuments({
      deliveryMan: courier._id,
      orderStatus: 'completed',
    });

    const totalPickups = await Pickup.countDocuments({
      assignedDriver: courier._id,
      picikupStatus: 'completed',
    });

    const cancelledOrders = await Order.countDocuments({
      deliveryMan: courier._id,
      orderStatus: { $in: ['canceled', 'rejected'] },
    });

    const successRate =
      totalDeliveries > 0
        ? Math.round((completedOrders / totalDeliveries) * 100)
        : 0;

    const customerRating = 4.8; // Placeholder for customer rating

    const deliveryHistory = await Order.find({
      deliveryMan: courier._id,
    })
      .sort({ updatedAt: -1 })
      .populate('business');

    const pickupHistory = await Pickup.find({
      assignedDriver: courier._id,
    })
      .sort({ updatedAt: -1 })
      .populate('business');

    res.render('admin/courier-details', {
      title: 'Courier Details',
      page_title: 'Courier Details',
      folder: 'Pages',
      courier: {
        id: courier._id,
        courierId: courier.courierID,
        name: courier.name,
        nationalId: courier.nationalId,
        dateOfBirth: courier.dateOfBirth,
        allPapers: courier.allPapers,
        zones: courier.assignedZones,
        photo: courier.personalPhoto || '/placeholder.svg?height=100&width=100',
        status: courier.isAvailable ? 'Active' : 'Inactive',
        statusBadge: courier.isAvailable
          ? 'bg-success-subtle text-success'
          : 'bg-danger-subtle text-danger',
        moneyWithCourier: moneyWithCourier[0]?.total || 0,
        ordersToReturn,
        activeOrders,
        totalDeliveries,
        totalPickups,
        successRate,
        customerRating,
        assignedZones: courier.assignedZones || [],
        phone: courier.phoneNumber,
        email: courier.personalEmail,
        address: courier.address,
        vehicle: `${courier.vehicleType} (${courier.vehiclePlateNumber})`,
        joinedDate: courier.createdAt,
      },
      deliveryHistory,
      pickupHistory,
    });
  } catch (error) {
    console.error('Error in get_courierDetailsPage:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// ======================================== Pickups Page ======================================== //

const get_pickupsPage = (req, res) => {
  res.render('admin/pickups', {
    title: 'Pickups',
    page_title: 'Pickups',
    folder: 'Pages',
  });
};

const get_pickups = async (req, res) => {
  try {
    const { pickupType, statusCategory, dateFrom, dateTo, search } = req.query;
    let match = {};

    // Handle legacy pickupType parameter
    if (pickupType === 'Upcoming') {
      match = {
        statusCategory: {
          $in: [
            statusHelper.STATUS_CATEGORIES.NEW,
            statusHelper.STATUS_CATEGORIES.PROCESSING,
          ],
        },
      };
    } else if (pickupType === 'Completed') {
      match = { statusCategory: statusHelper.STATUS_CATEGORIES.SUCCESSFUL };
    } else if (pickupType === 'Cancelled') {
      match = {
        statusCategory: statusHelper.STATUS_CATEGORIES.UNSUCCESSFUL,
        picikupStatus: 'canceled',
      };
    } else if (pickupType === 'inStock') {
      match = { picikupStatus: 'inStock' };
    }

    // Override with direct status category if provided
    if (statusCategory && statusHelper.STATUS_CATEGORIES[statusCategory]) {
      match.statusCategory = statusCategory;
    }

    // Date range filter on pickupDate
    if (dateFrom || dateTo) {
      match.pickupDate = {};
      if (dateFrom) match.pickupDate.$gte = new Date(dateFrom);
      if (dateTo) match.pickupDate.$lte = new Date(dateTo);
    }

    // Build aggregation pipeline
    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'users',
          localField: 'business',
          foreignField: '_id',
          as: 'business',
        },
      },
      { $unwind: '$business' },
      {
        $lookup: {
          from: 'couriers',
          localField: 'assignedDriver',
          foreignField: '_id',
          as: 'assignedDriver',
        },
      },
      {
        $unwind: { path: '$assignedDriver', preserveNullAndEmptyArrays: true },
      },
    ];

    // Text search filter
    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      pipeline.push({
        $match: {
          $or: [
            { pickupNumber: { $regex: regex } },
            { phoneNumber: { $regex: regex } },
            { 'business.brandInfo.brandName': { $regex: regex } },
            { 'business.name': { $regex: regex } },
          ],
        },
      });
    }

    pipeline.push({ $sort: { pickupTime: -1, pickupDate: -1, createdAt: -1 } });
    
    // Add a field to determine the correct city from the selected pickup address
    pipeline.push({
      $addFields: {
        pickupCity: {
          $let: {
            vars: {
              selectedAddress: {
                $cond: {
                  if: { $and: [
                    { $ne: ['$pickupAddressId', null] },
                    { $isArray: '$business.pickUpAddresses' }
                  ]},
                  then: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$business.pickUpAddresses',
                          as: 'addr',
                          cond: { $eq: ['$$addr.addressId', '$pickupAddressId'] }
                        }
                      },
                      0
                    ]
                  },
                  else: null
                }
              }
            },
            in: {
              $cond: {
                if: { $ne: ['$$selectedAddress', null] },
                then: '$$selectedAddress.city',
                else: {
                  $cond: {
                    if: { $gt: [{ $size: { $ifNull: ['$business.pickUpAddresses', []] } }, 0] },
                    then: {
                      $let: {
                        vars: {
                          defaultAddr: {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: '$business.pickUpAddresses',
                                  as: 'addr',
                                  cond: { $eq: ['$$addr.isDefault', true] }
                                }
                              },
                              0
                            ]
                          }
                        },
                        in: {
                          $cond: {
                            if: { $ne: ['$$defaultAddr', null] },
                            then: '$$defaultAddr.city',
                            else: { $arrayElemAt: ['$business.pickUpAddresses.city', 0] }
                          }
                        }
                      }
                    },
                    else: '$business.pickUpAdress.city'
                  }
                }
              }
            }
          }
        }
      }
    });
    
    pipeline.push({
      $group: {
        _id: '$pickupCity',
        pickups: { $push: '$$ROOT' },
      },
    });

    const pickups = await Pickup.aggregate(pipeline);

    // Add status information to each pickup
    const enhancedPickups = pickups.map((group) => {
      const enhancedGroup = {
        _id: group._id,
        pickups: group.pickups.map((pickup) => ({
          ...pickup,
          statusLabel: statusHelper.getPickupStatusLabel(pickup.picikupStatus),
          statusDescription: statusHelper.getPickupStatusDescription(
            pickup.picikupStatus
          ),
          categoryClass: statusHelper.getCategoryClass(pickup.statusCategory),
          categoryColor: statusHelper.getCategoryColor(pickup.statusCategory),
        })),
      };
      return enhancedGroup;
    });

    res.status(200).json(enhancedPickups || []);
  } catch (error) {
    console.error('Error in pickups:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const get_pickupMenByZone = async (req, res) => {
  const { city, zone } = req.query;
  try {
    // Prefer zone over city for more accurate courier matching
    const searchZone = zone || city;
    
    console.log('Looking for couriers in zone/city:', searchZone);
    
    const zoneQuery = courierAssignedZonesMatchQuery(searchZone);
    if (!zoneQuery) {
      return res.status(200).json([]);
    }
    const deliveryMen = await Courier.find({
      $and: [zoneQuery, { isAvailable: true }],
    });
    
    console.log(`Found ${deliveryMen.length} couriers for zone: ${searchZone}`);
    
    res.status(200).json(deliveryMen);
  } catch (error) {
    console.error('Error fetching delivery men:', error);

    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const assignPickupMan = async (req, res) => {
  const { pickupId, courierId } = req.body;
  try {
    const pickup = await Pickup.findOne({ _id: pickupId }).populate('business');
    if (!pickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    const courier = await Courier.findOne({ _id: courierId });

    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }
    console.log('courier assig');
    pickup.assignedDriver = courierId;
    pickup.picikupStatus = 'driverAssigned';
    pickup.pickupStages.push({
      stageName: 'driverAssigned',
      stageDate: new Date(),
      stageNotes: [
        {
          text: `Pickup assigned to ${courier.name}`,
          date: new Date(),
        },
      ],
    });

    // courier.isAvailable = false;

    await pickup.save();

    // Send push notification to courier about pickup assignment
    try {
      await firebase.sendPickupAssignmentNotification(
        courierId,
        pickup.pickupNumber,
        {
          pickupId: pickup._id,
          businessName:
            pickup.business?.brandInfo?.brandName ||
            pickup.business?.name ||
            'Business',
          assignedBy: 'Admin',
        }
      );
      console.log(
        `📱 Push notification sent to courier ${courierId} about pickup assignment ${pickup.pickupNumber}`
      );
    } catch (notificationError) {
      console.error(
        `❌ Failed to send push notification to courier ${courierId}:`,
        notificationError.message
      );
      console.error('🔍 Pickup assignment notification error context:', {
        courierId,
        pickupNumber: pickup.pickupNumber,
        pickupId: pickup._id,
        errorCode: notificationError.code || 'N/A',
        errorType: notificationError.constructor.name,
        errorStack: notificationError.stack?.split('\n')[0] || 'N/A',
        timestamp: new Date().toISOString(),
      });
      console.error(
        '💡 This is a non-critical error - pickup assignment will still succeed'
      );
      // Don't fail the assignment if notification fails
    }

    // Send push notification to business about pickup assignment
    try {
      await firebase.sendPickupStatusNotification(
        pickup.business._id,
        pickup.pickupNumber,
        'driverAssigned',
        {
          courierName: courier.name,
          assignedAt: new Date(),
          assignedBy: 'Admin',
        }
      );
      console.log(
        `📱 Push notification sent to business ${pickup.business._id} about pickup assignment ${pickup.pickupNumber}`
      );
    } catch (notificationError) {
      console.error(
        `❌ Failed to send push notification to business ${pickup.business._id}:`,
        notificationError.message
      );
      console.error('🔍 Business notification error context:', {
        businessId: pickup.business._id,
        businessName:
          pickup.business?.brandInfo?.brandName ||
          pickup.business?.name ||
          'Business',
        pickupNumber: pickup.pickupNumber,
        pickupId: pickup._id,
        courierName: courier.name,
        errorCode: notificationError.code || 'N/A',
        errorType: notificationError.constructor.name,
        errorStack: notificationError.stack?.split('\n')[0] || 'N/A',
        timestamp: new Date().toISOString(),
      });
      console.error(
        '💡 This is a non-critical error - pickup assignment will still succeed'
      );
      // Don't fail the assignment if notification fails
    }

    res.status(200).json({ message: 'Pickup man assigned successfully' });
  } catch (error) {
    console.error('❌ Error assigning pickup Man:', error.message);
    console.error('🔍 Pickup assignment error context:', {
      courierId,
      pickupId: req.params.pickupId,
      errorCode: error.code || 'N/A',
      errorType: error.constructor.name,
      errorStack: error.stack?.split('\n')[0] || 'N/A',
      timestamp: new Date().toISOString(),
      requestBody: req.body,
      requestParams: req.params,
    });
    res.status(500).json({
      error: 'Internal server error. Please try again.',
      errorCode: error.code || 'N/A',
      message: error.message,
    });
  }
};

const get_pickupDetailsPage = async (req, res) => {
  const { pickupNumber } = req.params;

  const pickup = await Pickup.findOne({ pickupNumber })
    .populate('business')
    .populate('assignedDriver');

  if (!pickup) {
    res.render('admin/pickup-details', {
      title: 'Pickup Details',
      page_title: 'Pickup Details',
      folder: 'Pages',
      pickup: null,
    });
    return;
  }

  const { address: selectedPickupAddress } = resolvePickupAddressForOrder(
    { selectedPickupAddressId: pickup.pickupAddressId },
    pickup.business
  );

  res.render('admin/pickup-details', {
    title: 'Pickup Details',
    page_title: 'Pickup Details',
    folder: 'Pages',
    pickup,
    selectedPickupAddress: selectedPickupAddress
  });
};

const get_pickedupOrders = async (req, res) => {
  const { pickupNumber } = req.params;
  const { search } = req.query;
  try {
    const pickedUpOrders = await Pickup.findOne(
      { pickupNumber },
      { ordersPickedUp: 1 }
    ).populate({
      path: 'ordersPickedUp',
      match: search ? { orderNumber: search } : {},
    });

    if (!pickedUpOrders) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    console.log(pickedUpOrders);
    res.status(200).json(pickedUpOrders || []);
  } catch (error) {
    console.error('Error in get_pickedupOrders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const cancelPickup = async (req, res) => {
  const { pickupId } = req.params;

  try {
    const pickup = await Pickup.findById(pickupId)
      .populate('assignedDriver')
      .populate('business');

    if (!pickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    pickup.picikupStatus = 'canceled';
    // pickup.pickupStages.push({
    //   stageName: 'Cancelled',
    //   stageDate: new Date(),
    //   stageNotes: [
    //     {
    //       text: 'Pickup cancelled',
    //       date: new Date(),
    //     },
    //   ],
    // });

    // pickup.assignedDriver.isAvailable = true;

    await pickup.save();

    // Send push notification to business about pickup cancellation
    try {
      await firebase.sendPickupStatusNotification(
        pickup.business._id,
        pickup.pickupNumber,
        'canceled',
        {
          cancelledAt: new Date(),
          cancelledBy: 'Admin',
        }
      );
      console.log(
        `📱 Push notification sent to business ${pickup.business._id} about pickup cancellation ${pickup.pickupNumber}`
      );
    } catch (notificationError) {
      console.error(
        `❌ Failed to send push notification to business ${pickup.business._id}:`,
        notificationError
      );
      // Don't fail the cancellation if notification fails
    }

    // Send push notification to courier about pickup cancellation (if assigned)
    if (pickup.assignedDriver) {
      try {
        await firebase.sendPickupStatusNotification(
          pickup.assignedDriver._id,
          pickup.pickupNumber,
          'canceled',
          {
            cancelledAt: new Date(),
            cancelledBy: 'Admin',
          }
        );
        console.log(
          `📱 Push notification sent to courier ${pickup.assignedDriver._id} about pickup cancellation ${pickup.pickupNumber}`
        );
      } catch (notificationError) {
        console.error(
          `❌ Failed to send push notification to courier ${pickup.assignedDriver._id}:`,
          notificationError
        );
        // Don't fail the cancellation if notification fails
      }
    }

    res.status(200).json({ message: 'Pickup cancelled successfully' });
  } catch (error) {
    console.error('Error in cancelPickup:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const deletePickup = async (req, res) => {
  const { pickupId } = req.params;

  try {
    const deletedPickup = await Pickup.findByIdAndDelete(pickupId);

    if (!deletedPickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    res.status(200).json({ message: 'Pickup deleted successfully.' });
  } catch (error) {
    console.error('Error in deletePickup:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// ========================================End Pickups ======================================== //

// ======================================== Stock Managment ======================================== //

const get_stockManagementPage = (req, res) => {
  res.render('admin/stock-management', {
    title: 'Stock Managment',
    page_title: 'Stock Managment',
    folder: 'Pages',
  });
};

const get_stock_orders = async (req, res) => {
  try {
    const orders = await Order.find({
      orderStatus: { $in: ['inStock', 'inProgress'] },
    })
      .populate('business')
      .populate('deliveryMan');
    res.status(200).json(orders || []);
  } catch (error) {
    console.error('Error in get_stock_orders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const add_to_stock = async (req, res) => {
  const { orderNumber } = req.body;
  try {
    const order = await Order.findOne({ orderNumber });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.orderStatus === 'inStock') {
      return res.status(400).json({ error: 'Order is already in stock' });
    }

    if (order.orderStatus === 'inProgress') {
      return res.status(400).json({ error: 'Order is already in progress' });
    }

    if (order.Attemps == 2) {
      return res
        .status(400)
        .json({ error: 'Order has exceeded its attempts.' });
    }

    let pickupCompleted = false;
    let completedPickup = null;

    if (order.orderStatus === 'pickedUp') {
      order.orderStatus = 'inStock';
      if (!order.orderStages.packed.isCompleted) {
        order.orderStages.packed.isCompleted = true;
        order.orderStages.packed.completedAt = new Date();
        order.orderStages.packed.notes = 'Order added to stock';
      }
    } else if (order.orderStatus === 'waitingAction') {
      order.orderStatus = 'inStock';
      if (!order.orderStages.packed.isCompleted) {
        order.orderStages.packed.isCompleted = true;
        order.orderStages.packed.completedAt = new Date();
        order.orderStages.packed.notes = 'Order added to stock';
      }
    } else {
      return res.status(400).json({ error: "Order can't be added to stock" });
    }

    await order.save();

    // Check if this order was part of a pickup and if all orders in that pickup are now in stock
    const pickup = await Pickup.findOne({
      ordersPickedUp: order._id,
    }).populate('ordersPickedUp');

    if (pickup && pickup.picikupStatus !== 'completed') {
      // Check if all orders in this pickup are now in stock
      const allOrdersInStock = pickup.ordersPickedUp.every(
        (order) =>
          order.orderStatus === 'inStock' || order.orderStatus === 'inProgress'
      );

      if (allOrdersInStock) {
        // Mark pickup as completed
        pickup.picikupStatus = 'completed';
        pickup.pickupStages.push({
          stageName: 'completed',
          stageDate: new Date(),
          stageNotes: [
            {
              text: 'All orders from pickup added to stock - pickup completed',
              date: new Date(),
            },
          ],
        });

        await pickup.save();

        pickupCompleted = true;
        completedPickup = pickup;
      }
    }

    res.status(200).json({
      message: 'Order added to stock successfully',
      pickupCompleted: pickupCompleted,
      pickup: pickupCompleted ? completedPickup : null,
    });
  } catch (error) {
    console.error('Error in add_to_stock:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const get_couriers_by_zone = async (req, res) => {
  const { zone } = req.query;
  try {
    const zoneQuery = courierAssignedZonesMatchQuery(zone);
    if (!zoneQuery) {
      return res.status(200).json([]);
    }
    const couriers = await Courier.find(zoneQuery);
    res.status(200).json(couriers || []);
  } catch (error) {
    console.error('Error in get_couriers_by_zone:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

/**
 * Assign courier to stock orders with proper status transition
 */
const assignCourierToStock = async (req, res) => {
  const { orderNumbers, courierId } = req.body;
  try {
    console.log(orderNumbers, courierId);
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orders = await Order.find({ orderNumber: { $in: orderNumbers } });
    if (orders.length !== orderNumbers.length) {
      return res.status(404).json({ error: 'Some orders not found' });
    }

    // Validate all orders before making any changes
    for (const order of orders) {
      if (order.orderStatus !== 'inProgress') {
        // Same rules for all order types (including Exchange): must be in warehouse pipeline
        const validStatuses = ['inStock', 'pickedUp'];

        const isFastShipping =
          order.orderShipping && order.orderShipping.isExpressShipping;

        if (
          !isFastShipping &&
          !validStatuses.includes(order.orderStatus)
        ) {
          return res
            .status(400)
            .json({ error: `Order ${order.orderNumber} is not in stock` });
        }

        if (
          order.orderStatus === 'headingToCustomer' ||
          order.orderStatus === 'headingToYou'
        ) {
          return res.status(400).json({
            error: `Order ${order.orderNumber} Can\'t be assigned to courier because it is on the way to customer`,
          });
        }
      }
    }

    // Update all orders after validation passes
    // Exchange uses the same path as Deliver/Return: pickup → stock → assign courier here → inProgress → customer.
    const updatePromises = orders.map((order) => {
      order.deliveryMan = courierId;

      const isFastShipping =
        order.orderShipping && order.orderShipping.isExpressShipping;

      order.orderStatus = 'inProgress';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;

      if (isFastShipping) {
        if (!order.orderStages.inProgress.isCompleted) {
          order.orderStages.inProgress.isCompleted = true;
          order.orderStages.inProgress.completedAt = new Date();
          order.orderStages.inProgress.notes = `Fast shipping order assigned to courier ${courier.name} - ready for pickup from business`;
        }

        order.courierHistory.push({
          courier: courierId,
          assignedAt: new Date(),
          action: 'assigned',
          notes: `Fast shipping order assigned to courier ${courier.name} - proceed to business for pickup`,
        });
      } else {
        if (!order.orderStages.shipping.isCompleted) {
          order.orderStages.shipping.isCompleted = true;
          order.orderStages.shipping.completedAt = new Date();
          order.orderStages.shipping.notes = `Order assigned to courier ${courier.name}`;
        }

        order.courierHistory.push({
          courier: courierId,
          assignedAt: new Date(),
          action: 'assigned',
          notes: `Courier ${courier.name} assigned to deliver ${order.orderShipping.orderType} order`,
        });
      }

      return order.save();
    });

    await Promise.all(updatePromises);

    // Send push notification to courier about new assignments
    try {
      await firebase.sendCourierAssignmentNotification(
        courierId,
        orders.length > 1 ? `${orders.length} orders` : orders[0].orderNumber,
        'assigned',
        {
          ordersCount: orders.length,
          orderNumbers: orderNumbers,
          assignedBy: 'Admin',
        }
      );
      console.log(
        `📱 Push notification sent to courier ${courierId} about ${orders.length} new order assignments`
      );
    } catch (notificationError) {
      console.error(
        `❌ Failed to send push notification to courier ${courierId}:`,
        notificationError
      );
      // Don't fail the assignment if notification fails
    }

    res
      .status(200)
      .json({ message: 'Orders assigned to courier successfully' });
  } catch (error) {
    console.error('Error in assignCourierToStock:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const courier_received = async (req, res) => {
  const { courierId } = req.body;
  try {
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orders = await Order.find({
      deliveryMan: courierId,
      orderStatus: 'inProgress',
    }).populate('business', 'name brandInfo');

    if (!orders.length) {
      return res
        .status(404)
        .json({ error: 'No orders found for this courier' });
    }

    const updatePromises = orders.map((order) => {
      order.orderStatus = 'headingToCustomer';

      if (!order.orderStages.inProgress.isCompleted) {
        order.orderStages.inProgress.isCompleted = true;
        order.orderStages.inProgress.completedAt = new Date();
        order.orderStages.inProgress.notes = `Order assigned to courier ${courier.name}`;
      }
      if (!order.orderStages.outForDelivery.isCompleted) {
        order.orderStages.outForDelivery.isCompleted = true;
        order.orderStages.outForDelivery.completedAt = new Date();
        order.orderStages.outForDelivery.notes = `Order marked as received by courier ${courier.name}`;
      }

      // Generate 24h OTP for delivery verification
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      order.deliveryOtp = {
        otpHash: require('bcrypt').hashSync(otp, 10),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        verifiedAt: null,
        attempts: 0,
      };

      // Send SMS OTP to customer
      const phone = order.orderCustomer?.phoneNumber;
      const brand = order.business?.brandInfo?.brandName || order.business?.name || 'NowShipping';
      console.log("Delivery OTP Phone: ", otp)
      if (phone) {
        sendSms({
          recipient: phone,
          message: `NowShipping - ${brand}: Your delivery OTP for order ${order.orderNumber} is ${otp}. Valid for 24 hours.`
        }).catch((e) => console.error(`SMS OTP error for ${order.orderNumber}:`, e.details || e.message));
      }

      return order.save();
    });

    await Promise.all(updatePromises);

    // Send WhatsApp notifications to customers
    const { sendHeadingToCustomerNotification } = require('../utils/whatsapp');
    for (const order of orders) {
      order.deliveryMan = courier;
      sendHeadingToCustomerNotification(order)
        .catch(e => console.error(`WhatsApp error for ${order.orderNumber}:`, e.message));
    }

    res
      .status(200)
      .json({ message: 'Orders marked as received by courier successfully' });
  } catch (error) {
    console.error('Error in courier_received:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// ================ Stock Returns =================== //

const get_stockReturnsPage = (req, res) => {
  res.render('admin/stock-returns', {
    title: 'Stock Returns',
    page_title: 'Stock Returns',
    folder: 'Pages',
  });
};

const getReturnedOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [
        { orderStatus: { $in: ['returnAtWarehouse', 'inReturnStock'] } },
        { 'orderShipping.orderType': 'Return' },
      ],
    })
      .populate('business', 'brandInfo')
      .populate('deliveryMan')
      .sort({ orderDate: -1, createdAt: -1 });

    console.log(orders);
    res.status(200).json(orders || []);
  } catch (error) {
    console.error('Error in getReturnedOrders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Note: Removed approveReturn and rejectReturn functions as admin no longer needs to approve returns

/**
 * Add a return to stock with proper status categorization
 */
const add_return_to_stock = async (req, res) => {
  const { orderNumber, returnReason, returnNotes } = req.body;

  try {
    const order = await Order.findOne({ orderNumber });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.orderStatus === 'inReturnStock') {
      return res
        .status(400)
        .json({ error: 'Order is already in return stock' });
    }

    if (order.orderStatus === 'inProgress') {
      return res.status(400).json({ error: 'Order is in progress' });
    }

    // ensure order not heading to customer
    if (
      order.orderStatus === 'headingToCustomer' ||
      order.orderStatus === 'headingToYou'
    ) {
      return res.status(400).json({ error: 'Order is on the way to customer' });
    }

    // Case 1: Order comes from waitingAction, returnToWarehouse, or rejected status
    // This happens when delivery attempts fail
    if (
      order.orderStatus === 'waitingAction' ||
      order.orderStatus === 'returnToWarehouse' ||
      order.orderStatus === 'rejected'
    ) {
      order.orderStatus = 'inReturnStock';

      // If it's not already a return type, change it to a return
      if (order.orderShipping.orderType !== 'Return') {
        order.orderShipping.orderType = 'Return';
      }

      // Add return reason if provided
      if (returnReason) {
        order.orderShipping.returnReason = returnReason;
      }

      // Add return notes if provided
      if (returnNotes) {
        order.orderShipping.returnNotes = returnNotes;
      }

      // Update inProgress stage for return
      if (!order.orderStages.inProgress.isCompleted) {
        order.orderStages.inProgress.isCompleted = true;
        order.orderStages.inProgress.completedAt = new Date();
        order.orderStages.inProgress.notes =
          'Order added to return stock after failed delivery attempt';
      }

      // Update returnAtWarehouse stage to mark it as completed
      order.orderStages.returnAtWarehouse.isCompleted = true;
      order.orderStages.returnAtWarehouse.completedAt = new Date();
      order.orderStages.returnAtWarehouse.notes =
        'Order received at warehouse and added to return stock';
    }
    // Case 2: Order is a new return initiated by the business
    else if (order.orderStatus === 'returnInitiated') {
      order.orderStatus = 'returnAtWarehouse';

      // Add return reason if provided
      if (returnReason) {
        order.orderShipping.returnReason = returnReason;
      }

      // Add return notes if provided
      if (returnNotes) {
        order.orderShipping.returnNotes = returnNotes;
      }

      // Update returnAtWarehouse stage
      order.orderStages.returnAtWarehouse.isCompleted = true;
      order.orderStages.returnAtWarehouse.completedAt = new Date();
      order.orderStages.returnAtWarehouse.notes =
        'Return order added to warehouse by admin';
    }
    // Case 3: Order is completed and needs to be returned
    else if (order.orderStatus === 'completed') {
      order.orderStatus = 'returnAtWarehouse';

      // Change order type to return
      order.orderShipping.orderType = 'Return';

      // Add return reason if provided
      if (returnReason) {
        order.orderShipping.returnReason = returnReason;
      }

      // Add return notes if provided
      if (returnNotes) {
        order.orderShipping.returnNotes = returnNotes;
      }

      // Update returnAtWarehouse stage
      order.orderStages.returnAtWarehouse.isCompleted = true;
      order.orderStages.returnAtWarehouse.completedAt = new Date();
      order.orderStages.returnAtWarehouse.notes =
        'Completed order added to return warehouse by admin';
    }
    // Case 4: Order is already at warehouse but needs to be processed as return
    else if (order.orderStatus === 'returnAtWarehouse') {
      // Change status to inReturnStock since order is at warehouse
      order.orderStatus = 'inReturnStock';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;

      // Update return details
      if (returnReason) {
        order.orderShipping.returnReason = returnReason;
      }

      if (returnNotes) {
        order.orderShipping.returnNotes = returnNotes;
      }

      // Update returnAtWarehouse stage - mark as completed if not already
      if (!order.orderStages.returnAtWarehouse.isCompleted) {
        order.orderStages.returnAtWarehouse.isCompleted = true;
        order.orderStages.returnAtWarehouse.completedAt = new Date();
      }
      order.orderStages.returnAtWarehouse.notes =
        'Return order received at warehouse and added to return stock by admin';
    }
    // Case 5: Handle returnPickedUp status (courier picked up but hasn't delivered to warehouse yet)
    // This shouldn't normally happen, but we can handle it by transitioning through returnAtWarehouse
    else if (order.orderStatus === 'returnPickedUp') {
      // First transition to returnAtWarehouse, then to inReturnStock
      order.orderStatus = 'inReturnStock';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;

      // Update return details
      if (returnReason) {
        order.orderShipping.returnReason = returnReason;
      }

      if (returnNotes) {
        order.orderShipping.returnNotes = returnNotes;
      }

      // Mark returnAtWarehouse as completed (assuming it arrived at warehouse)
      // Get admin ID from either req.adminData or req.userData (for API compatibility)
      const adminId = (req.adminData && req.adminData._id) || (req.userData && req.userData._id) || null;
      
      order.orderStages.returnAtWarehouse = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Return received at warehouse and added to return stock by admin (transitioned from returnPickedUp)',
        receivedBy: adminId,
        warehouseLocation: 'Main Warehouse',
        conditionNotes: returnNotes || ''
      };
    } else {
      return res.status(400).json({
        error: `Order status '${order.orderStatus}' cannot be changed to return stock. Allowed statuses: completed, returnInitiated, waitingAction, returnToWarehouse, rejected, returnAtWarehouse, returnPickedUp`,
      });
    }

    await order.save();

    res
      .status(200)
      .json({ message: 'Order added to return stock successfully' });
  } catch (error) {
    console.error('Error in add_return_to_stock:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Enhanced Assign courier to pick up return from customer
const assignCourierToReturn = async (req, res) => {
  const { orderNumbers, courierId } = req.body;

  try {
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orderIds = orderNumbers;
    const orders = await Order.find({ orderNumber: { $in: orderIds } });

    if (orders.length !== orderIds.length) {
      return res.status(404).json({ error: 'Some orders not found' });
    }

    for (const order of orders) {
      // Enhanced validation for new return flow
      const validReturnStatuses = [
        'new',
        'returnInitiated',
        'inReturnStock',
        'returnLinked',
      ];

      if (!validReturnStatuses.includes(order.orderStatus)) {
        return res.status(400).json({
          error: `Order ${order.orderNumber} (${
            order.orderStatus
          }) is not ready for courier assignment. Valid statuses: ${validReturnStatuses.join(
            ', '
          )}`,
        });
      }

      if (
        order.orderStatus === 'headingToCustomer' ||
        order.orderStatus === 'headingToYou'
      ) {
        return res.status(400).json({
          error: `Order ${order.orderNumber} is already assigned to a courier`,
        });
      }

      // Check if this is a Return order type
      if (order.orderShipping.orderType !== 'Return') {
        return res
          .status(400)
          .json({ error: `Order ${order.orderNumber} is not a return order` });
      }

      order.deliveryMan = courierId;
      order.orderStatus = 'returnAssigned';

      // Generate return pickup OTP and SMS it to the customer
      const returnOtpPlain = String(Math.floor(100000 + Math.random() * 900000));
      const returnOtpNow = new Date();
      order.returnOtp = {
        otpHash:    bcrypt.hashSync(returnOtpPlain, 10),
        expiresAt:  new Date(Date.now() + 24 * 60 * 60 * 1000),
        issuedAt:   returnOtpNow,
        verifiedAt: null,
        attempts:   0,
      };

      // SMS the OTP to the customer (reference original order number so they recognise it)
      const returnOtpOriginalRef = order.orderShipping?.originalOrderNumber || order.orderNumber;
      const returnOtpPhone = order.orderCustomer?.phoneNumber;
      const returnOtpBrand = order.business?.brandInfo?.brandName || order.business?.name || 'NowShipping';
      console.log("Return OTP Phone: ", returnOtpPlain)
      if (returnOtpPhone) {
        sendSms({
          recipient: returnOtpPhone,
          message: `NowShipping - ${returnOtpBrand}: Return pickup OTP for order ${returnOtpOriginalRef} is ${returnOtpPlain}. Share this code ONLY with the courier at pickup. Valid for 24 hours.`,
        }).catch((e) => console.error(`SMS return OTP error for ${order.orderNumber}:`, e.details || e.message));
      } else {
        console.warn(`⚠️ No phone number for return order ${order.orderNumber} — SMS OTP skipped`);
      }

      // Update return stages
      order.orderStages.returnAssigned.isCompleted = true;
      order.orderStages.returnAssigned.completedAt = new Date();
      order.orderStages.returnAssigned.notes = `Return order assigned to courier ${courier.name} for pickup from customer`;

      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'assigned',
        notes: `Courier ${courier.name} assigned to pick up return order from customer${returnOtpPhone ? ' (OTP SMS sent to customer)' : ' (no phone — OTP SMS skipped)'}`,
      });

      // If this return order is linked to a deliver order, update the deliver order status too
      if (order.orderShipping.linkedDeliverOrder) {
        const linkedDeliverOrder = await Order.findById(
          order.orderShipping.linkedDeliverOrder
        );
        if (linkedDeliverOrder) {
          linkedDeliverOrder.orderStatus = 'returnAssigned';
          linkedDeliverOrder.orderStages.returnAssigned.isCompleted = true;
          linkedDeliverOrder.orderStages.returnAssigned.completedAt =
            new Date();
          linkedDeliverOrder.orderStages.returnAssigned.notes = `Return pickup assigned to courier ${courier.name}`;
          await linkedDeliverOrder.save();
        }
      }
    }

    await Promise.all(orders.map((order) => order.save()));

    // Send push notification to courier about return assignments
    try {
      await firebase.sendCourierAssignmentNotification(
        courierId,
        orders.length > 1 ? `${orders.length} returns` : orders[0].orderNumber,
        'return_pickup',
        {
          ordersCount: orders.length,
          orderNumbers: orderNumbers,
          assignedBy: 'Admin',
        }
      );
      console.log(
        `📱 Push notification sent to courier ${courierId} about ${orders.length} return pickup assignments`
      );
    } catch (notificationError) {
      console.error(
        `❌ Failed to send push notification to courier ${courierId}:`,
        notificationError
      );
      // Don't fail the assignment if notification fails
    }

    // Send push notification to each business that a courier has been assigned and OTP sent
    for (const order of orders) {
      try {
        await firebase.sendOrderStatusNotification(
          order.business,
          order.orderNumber,
          'returnAssigned',
          {
            courierName: courier.name,
            otpSentToCustomer: true,
            otpIssuedAt: order.returnOtp?.issuedAt,
          }
        );
      } catch (bizNotifErr) {
        console.error(`❌ Failed to send returnAssigned push to business for order ${order.orderNumber}:`, bizNotifErr);
      }
    }

    res.status(200).json({
      message: 'Courier assigned to return orders successfully',
      assignedOrders: orders.length,
      courierName: courier.name,
    });
  } catch (error) {
    console.error('Error in assignCourierToReturn:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Resend the return pickup OTP to the customer (admin action — for expired/lost OTPs)
const resendReturnOtp = async (req, res) => {
  const { orderNumber } = req.params;
  try {
    const order = await Order.findOne({
      $or: [{ orderNumber }, { smartFlyerBarcode: orderNumber }],
      'orderShipping.orderType': 'Return',
      orderStatus: 'returnAssigned',
    }).populate('business', 'brandInfo name');

    if (!order) {
      return res.status(404).json({ error: 'Return order not found or not in returnAssigned status.' });
    }

    const otpPlain = String(Math.floor(100000 + Math.random() * 900000));
    const now = new Date();
    order.returnOtp = {
      otpHash:    bcrypt.hashSync(otpPlain, 10),
      expiresAt:  new Date(Date.now() + 24 * 60 * 60 * 1000),
      issuedAt:   now,
      verifiedAt: null,
      attempts:   0,
    };

    const originalRef = order.orderShipping?.originalOrderNumber || order.orderNumber;
    const phone = order.orderCustomer?.phoneNumber;
    const brand = order.business?.brandInfo?.brandName || order.business?.name || 'NowShipping';

    console.log("OTP Plain: ", otpPlain)
    if (phone) {
      sendSms({
        recipient: phone,
        message: `NowShipping - ${brand}: Your return pickup OTP for order ${originalRef} is ${otpPlain}. Share this code ONLY with the courier at pickup. Valid for 24 hours.`,
      }).catch((e) => console.error(`SMS resend return OTP error for ${order.orderNumber}:`, e.details || e.message));
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: phone ? 'Return OTP regenerated and SMS sent to customer.' : 'Return OTP regenerated. No phone number on file — SMS not sent.',
      otpIssuedAt: now,
      otpExpiresAt: order.returnOtp.expiresAt,
    });
  } catch (error) {
    console.error('Error in resendReturnOtp:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Scenario 2: Automatic Return Conversion for Failed Deliveries
const convertFailedDeliveryToReturn = async (req, res) => {
  const { orderId, reason } = req.params;

  try {
    const deliverOrder = await Order.findById(orderId);
    if (!deliverOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Only allow conversion for failed deliver orders
    if (
      deliverOrder.orderStatus !== 'deliveryFailed' &&
      deliverOrder.orderStatus !== 'rejected' &&
      deliverOrder.orderStatus !== 'canceled' &&
      deliverOrder.orderShipping.orderType !== 'Deliver'
    ) {
      return res.status(400).json({
        error: 'Order is not eligible for automatic return conversion',
      });
    }

    // Create a new Return order (R2) automatically
    const returnOrderNumber = await generateUniqueOrderNumber();
    const returnOrder = new Order({
      orderNumber: returnOrderNumber,
      orderDate: new Date(),
      orderStatus: 'autoReturnInitiated',
      orderFees: deliverOrder.orderFees, // Use same fees
      orderCustomer: deliverOrder.orderCustomer,
      orderShipping: {
        productDescription: deliverOrder.orderShipping.productDescription,
        numberOfItems: deliverOrder.orderShipping.numberOfItems,
        orderType: 'Return',
        amountType: deliverOrder.orderShipping.amountType,
        amount: deliverOrder.orderShipping.amount,
        isExpressShipping: deliverOrder.orderShipping.isExpressShipping,
        returnReason: reason || 'Delivery failed - automatic return',
        returnNotes: `Automatic return created due to delivery failure. Original order: ${deliverOrder.orderNumber}`,
        linkedDeliverOrder: deliverOrder._id,
        originalOrderNumber: deliverOrder.orderNumber,
      },
      orderStages: {
        orderPlaced: {
          isCompleted: true,
          completedAt: new Date(),
          notes: 'Automatic return order created due to delivery failure.',
        },
        packed: {
          isCompleted: false,
          completedAt: null,
          notes: '',
        },
        shipping: {
          isCompleted: false,
          completedAt: null,
          notes: '',
        },
        inProgress: {
          isCompleted: false,
          completedAt: null,
          notes: '',
        },
        outForDelivery: {
          isCompleted: false,
          completedAt: null,
          notes: '',
        },
        delivered: {
          isCompleted: false,
          completedAt: null,
          notes: '',
        },
      },
      business: deliverOrder.business,
    });

    let returnPickupId = deliverOrder.selectedPickupAddressId || null;
    if (!returnPickupId && deliverOrder.business) {
      const bizUser = await User.findById(deliverOrder.business).select('pickUpAddresses').lean();
      returnPickupId = getDefaultPickupAddressId(bizUser && bizUser.pickUpAddresses);
    }
    returnOrder.selectedPickupAddressId = returnPickupId;

    // Link the deliver order to the return order
    deliverOrder.orderShipping.linkedReturnOrder = returnOrder._id;
    deliverOrder.orderShipping.returnOrderCode = returnOrder.orderNumber;
    deliverOrder.orderStatus = 'autoReturnInitiated';

    // Update deliver order stages
    deliverOrder.orderStages.returnInitiated = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Automatic return initiated due to delivery failure. Return order: ${returnOrder.orderNumber}`,
    };

    await Promise.all([returnOrder.save(), deliverOrder.save()]);

    res.status(201).json({
      message: 'Failed delivery automatically converted to return order',
      deliverOrder: deliverOrder,
      returnOrder: returnOrder,
      returnOrderCode: returnOrder.orderNumber,
    });
  } catch (error) {
    console.error('Error converting failed delivery to return:', error);
    res.status(500).json({ error: 'Failed to convert delivery to return' });
  }
};

// Get all return orders with comprehensive filtering and management
const getAllReturnOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      dateFrom,
      dateTo,
      search,
      businessId,
      courierId,
      sortBy = 'orderDate',
      sortOrder = 'desc',
    } = req.query;

    const query = {
      'orderShipping.orderType': 'Return',
    };

    // Add status filter
    if (status && status !== 'all') {
      query.orderStatus = status;
    }

    // Add business filter
    if (businessId) {
      query.business = businessId;
    }

    // Add courier filter
    if (courierId) {
      query.deliveryMan = courierId;
    }

    // Add date range filter
    if (dateFrom || dateTo) {
      query.orderDate = {};
      if (dateFrom) query.orderDate.$gte = new Date(dateFrom);
      if (dateTo) query.orderDate.$lte = new Date(dateTo);
    }

    // Add search filter
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'orderCustomer.fullName': { $regex: search, $options: 'i' } },
        { 'orderCustomer.phoneNumber': { $regex: search, $options: 'i' } },
        { 'orderShipping.returnReason': { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const returnOrders = await Order.find(query)
      .populate('business', 'businessName email phone')
      .populate('deliveryMan', 'name phone email')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await Order.countDocuments(query);

    // Get return statistics
    const stats = await Order.aggregate([
      { $match: { 'orderShipping.orderType': 'Return' } },
      {
        $group: {
          _id: '$orderStatus',
          count: { $sum: 1 },
          totalFees: { $sum: '$totalFees' },
        },
      },
    ]);

    res.status(200).json({
      orders: returnOrders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + returnOrders.length < totalCount,
        hasPrev: parseInt(page) > 1,
      },
      statistics: stats,
    });
  } catch (error) {
    console.error('Error fetching return orders:', error);
    res.status(500).json({ error: 'Failed to fetch return orders' });
  }
};

// Get return order details for admin
const getReturnOrderDetailsAdmin = async (req, res) => {
  try {
    const { orderId } = req.params;

    const returnOrder = await Order.findOne({
      _id: orderId,
      'orderShipping.orderType': 'Return',
    })
      .populate('deliveryMan', 'name phone email')
      .populate('business', 'businessName email phone')
      .populate(
        'orderShipping.linkedDeliverOrder',
        'orderNumber orderStatus orderCustomer'
      );

    if (!returnOrder) {
      return res.status(404).json({ error: 'Return order not found' });
    }

    // Calculate progress percentage
    const returnStages = [
      'returnInitiated',
      'returnAssigned',
      'returnPickedUp',
      'returnAtWarehouse',
      'returnInspection',
      'returnProcessing',
      'returnToBusiness',
      'returnCompleted',
    ];

    const completedStages = returnStages.filter(
      (stage) => returnOrder.orderStages[stage]?.isCompleted
    ).length;

    const progressPercentage = Math.round(
      (completedStages / returnStages.length) * 100
    );

    // Get stage timeline
    const stageTimeline = returnStages.map((stage) => ({
      stage,
      isCompleted: returnOrder.orderStages[stage]?.isCompleted || false,
      completedAt: returnOrder.orderStages[stage]?.completedAt || null,
      notes: returnOrder.orderStages[stage]?.notes || '',
      ...returnOrder.orderStages[stage]?.toObject(),
    }));

    res.status(200).json({
      order: returnOrder,
      progressPercentage,
      stageTimeline,
      feeBreakdown: returnOrder.feeBreakdown,
      linkedDeliverOrder: returnOrder.orderShipping.linkedDeliverOrder,
    });
  } catch (error) {
    console.error('Error fetching return order details:', error);
    res.status(500).json({ error: 'Failed to fetch return order details' });
  }
};

// Update return order inspection
const updateReturnInspection = async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      inspectionResult,
      inspectionNotes,
      inspectionPhotos,
      conditionNotes,
      returnValue,
    } = req.body;

    const returnOrder = await Order.findOne({
      _id: orderId,
      'orderShipping.orderType': 'Return',
    });

    if (!returnOrder) {
      return res.status(404).json({ error: 'Return order not found' });
    }

    // Update inspection stage
    returnOrder.orderStages.returnInspection = {
      isCompleted: true,
      completedAt: new Date(),
      notes: inspectionNotes || '',
      inspectedBy: req.userData._id,
      inspectionResult: inspectionResult,
      inspectionPhotos: inspectionPhotos || [],
    };

    // Update return condition and value
    if (returnOrder.orderShipping) {
      returnOrder.orderShipping.returnCondition =
        req.body.returnCondition || returnOrder.orderShipping.returnCondition;
      returnOrder.orderShipping.returnValue =
        returnValue || returnOrder.orderShipping.returnValue;
      returnOrder.orderShipping.returnInspectionNotes = inspectionNotes || '';
    }

    // Update warehouse stage if inspection is completed
    if (inspectionResult === 'approved') {
      returnOrder.orderStages.returnAtWarehouse = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Return received and inspected at warehouse',
        receivedBy: req.userData._id,
        warehouseLocation: req.body.warehouseLocation || 'Main Warehouse',
        conditionNotes: conditionNotes || '',
      };
      returnOrder.orderStatus = 'returnAtWarehouse';
    }

    await returnOrder.save();

    res.status(200).json({
      message: 'Return inspection updated successfully',
      order: returnOrder,
    });
  } catch (error) {
    console.error('Error updating return inspection:', error);
    res.status(500).json({ error: 'Failed to update return inspection' });
  }
};

// Update return processing
const updateReturnProcessing = async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      processingType,
      processingNotes,
      refundAmount,
      exchangeOrderNumber,
    } = req.body;

    const returnOrder = await Order.findOne({
      _id: orderId,
      'orderShipping.orderType': 'Return',
    });

    if (!returnOrder) {
      return res.status(404).json({ error: 'Return order not found' });
    }

    // Update processing stage
    returnOrder.orderStages.returnProcessing = {
      isCompleted: true,
      completedAt: new Date(),
      notes: processingNotes || '',
      processedBy: req.userData._id,
      processingType: processingType,
    };

    // Update processing details
    if (returnOrder.orderShipping) {
      returnOrder.orderShipping.returnProcessingNotes = processingNotes || '';
      returnOrder.orderShipping.refundAmount = refundAmount || 0;
      returnOrder.orderShipping.exchangeOrderNumber = exchangeOrderNumber || '';
    }

    await returnOrder.save();

    res.status(200).json({
      message: 'Return processing updated successfully',
      order: returnOrder,
    });
  } catch (error) {
    console.error('Error updating return processing:', error);
    res.status(500).json({ error: 'Failed to update return processing' });
  }
};

// Assign courier to deliver return back to business
const assignCourierToReturnToBusiness = async (req, res) => {
  const { orderNumbers, courierId } = req.body;

  try {
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orderIds = orderNumbers;
    const orders = await Order.find({ orderNumber: { $in: orderIds } });

    if (orders.length !== orderIds.length) {
      return res.status(404).json({ error: 'Some orders not found' });
    }

    for (const order of orders) {
      // Allow returns at warehouse or in return stock to be assigned back to business
      if (
        order.orderStatus !== 'returnAtWarehouse' &&
        order.orderStatus !== 'inReturnStock'
      ) {
        return res.status(400).json({
          error: `Order ${order.orderNumber} is not at warehouse or in return stock`,
        });
      }

      order.deliveryMan = courierId;
      order.orderStatus = 'returnToBusiness';

      // Update return stages
      order.orderStages.returnToBusiness.isCompleted = true;
      order.orderStages.returnToBusiness.completedAt = new Date();
      order.orderStages.returnToBusiness.notes = `Return assigned to courier ${courier.name} for delivery to business`;

      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'pickup_from_warehouse',
        notes: `Courier ${courier.name} assigned to deliver return to business`,
      });
    }

    await Promise.all(orders.map((order) => order.save()));

    // Send push notification to courier about return delivery assignments
    try {
      await firebase.sendCourierAssignmentNotification(
        courierId,
        orders.length > 1 ? `${orders.length} returns` : orders[0].orderNumber,
        'return_delivery',
        {
          ordersCount: orders.length,
          orderNumbers: orderNumbers,
          assignedBy: 'Admin',
        }
      );
      console.log(
        `📱 Push notification sent to courier ${courierId} about ${orders.length} return delivery assignments`
      );
    } catch (notificationError) {
      console.error(
        `❌ Failed to send push notification to courier ${courierId}:`,
        notificationError
      );
      // Don't fail the assignment if notification fails
    }

    res.status(200).json({
      message: 'Courier assigned to deliver returns to business successfully',
    });
  } catch (error) {
    console.error('Error in assignCourierToReturnToBusiness:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const return_courier_received = async (req, res) => {
  const { courierId } = req.body;
  try {
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orders = await Order.find({
      deliveryMan: courierId,
      orderStatus: 'returnToWarehouse',
    });
    if (!orders.length) {
      return res
        .status(404)
        .json({ error: 'No orders found for this courier' });
    }
    const updatePromises = orders.map((order) => {
      order.orderStatus = 'inReturnStock';
      return order.save();
    });
    await Promise.all(updatePromises);
    res
      .status(200)
      .json({ message: 'Orders marked as received in return warehouse' });
  } catch (error) {
    console.error('Error in return_courier_received:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// ======================================== Payouts (replaces Release Amounts + Financial Processing) ======================================== //

const get_payoutsPage = (req, res) => {
  res.render('admin/payouts', {
    title: 'Payouts',
    page_title: 'Payouts Management',
    folder: 'Financial Management',
  });
};


/** Admin search for single-business payout: name, email, brand, or 8-digit account code */
const search_businessesForPayout = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ success: true, businesses: [] });
    }

    const { ensureBusinessAccountCode } = require('../utils/businessAccountCode');
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const safe = escapeRegex(q);
    const regex = new RegExp(safe, 'i');
    const isEightDigits = /^\d{8}$/.test(q);

    const orClauses = [
      { name: regex },
      { email: regex },
      { 'brandInfo.brandName': regex },
    ];
    if (isEightDigits) {
      orClauses.unshift({ businessAccountCode: q });
    }

    const users = await User.find({ ...businessRoleFilter(), $or: orClauses })
      .select('_id name email phoneNumber brandInfo businessAccountCode profileImage')
      .limit(25)
      .lean();

    const businesses = [];
    for (const u of users) {
      let code = u.businessAccountCode;
      if (!code) {
        code = await ensureBusinessAccountCode(u._id);
      }
      businesses.push({
        _id: u._id,
        name: u.name,
        email: u.email,
        phoneNumber: u.phoneNumber || '',
        brandName: u.brandInfo?.brandName || '',
        businessAccountCode: code,
        profileImage: u.profileImage || null,
      });
    }

    res.json({ success: true, businesses });
  } catch (err) {
    console.error('search_businessesForPayout error:', err);
    res.status(500).json({ success: false, error: 'Search failed' });
  }
};

const get_payouts = async (req, res) => {
  try {
    const { status, businessId, page = 1, limit = 50 } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;
    if (businessId) query.business = businessId;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [payouts, total] = await Promise.all([
      Payout.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('business', 'name email phoneNumber brandInfo paymentMethod businessAccountCode')
        .lean(),
      Payout.countDocuments(query),
    ]);

    // Attach current balance for each business in this page
    const businessIds = [...new Set(payouts.map(p => p.business._id))];
    const balanceMap = await ledgerService.getBalances(businessIds);

    const data = payouts.map(p => ({
      ...p,
      currentBalance: balanceMap.get(p.business._id.toString()) || 0,
    }));

    res.json({ success: true, payouts: data, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('get_payouts error:', err);
    res.status(500).json({ success: false, error: 'Failed to load payouts' });
  }
};

const markPayoutPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const payout = await Payout.findById(id).populate('business', 'name');
    if (!payout) return res.status(404).json({ success: false, error: 'Payout not found' });
    if (payout.status === 'paid') return res.status(400).json({ success: false, error: 'Payout already marked as paid' });

    payout.status = 'paid';
    payout.paidDate = new Date();
    if (note) payout.adminNote = note;
    await payout.save();

    console.log(`Payout ${payout._id} marked as paid for ${payout.business.name}`);
    res.json({ success: true, payout });
  } catch (err) {
    console.error('markPayoutPaid error:', err);
    res.status(500).json({ success: false, error: 'Failed to mark payout as paid' });
  }
};

// GET /admin/api/payouts/:id — full detail + all ledger entries for that payout
const get_payoutDetail = async (req, res) => {
  try {
    const payout = await Payout.findById(req.params.id)
      .populate('business', 'name email brandInfo paymentMethod businessAccountCode profileImage')
      .lean();
    if (!payout) return res.status(404).json({ success: false, error: 'Payout not found' });

    const entries = await LedgerEntry.find({ payoutId: payout._id })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ success: true, payout, entries });
  } catch (err) {
    console.error('get_payoutDetail error:', err);
    res.status(500).json({ success: false, error: 'Failed to load payout detail' });
  }
};

// GET /admin/api/payouts/:id/export — download Excel of payout entries
const export_payoutExcel = async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const payout = await Payout.findById(req.params.id)
      .populate('business', 'name email brandInfo businessAccountCode')
      .lean();
    if (!payout) return res.status(404).json({ success: false, error: 'Payout not found' });

    const entries = await LedgerEntry.find({ payoutId: payout._id })
      .sort({ createdAt: 1 })
      .lean();

    const biz = payout.business || {};
    const bizName = biz.brandInfo?.brandName || biz.name || 'Business';
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Now Shipping Admin';
    const ws = wb.addWorksheet('Payout Entries');

    // Header info rows
    ws.addRow(['Payout ID', String(payout._id)]);
    ws.addRow(['Business', bizName]);
    if (biz.businessAccountCode) ws.addRow(['Account Code', biz.businessAccountCode]);
    ws.addRow(['Status', payout.status]);
    ws.addRow(['Amount', payout.amount]);
    ws.addRow(['Scheduled Date', payout.scheduledDate ? new Date(payout.scheduledDate).toLocaleDateString('en-GB') : '—']);
    ws.addRow(['Paid Date', payout.paidDate ? new Date(payout.paidDate).toLocaleDateString('en-GB') : '—']);
    ws.addRow([]);

    // Table header
    const headerRow = ws.addRow(['Date', 'Type', 'Description', 'Order #', 'Pickup #', 'Amount (EGP)']);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF39720' } };

    const typeLabels = {
      cod_collected: 'COD Collected',
      delivery_fee: 'Delivery Fee',
      return_fee: 'Return Fee',
      pickup_fee: 'Pickup Fee',
      payout: 'Payout',
      adjustment: 'Adjustment',
    };

    entries.forEach(e => {
      const row = ws.addRow([
        e.createdAt ? new Date(e.createdAt).toLocaleDateString('en-GB') : '',
        typeLabels[e.type] || e.type || '',
        e.description || '',
        e.orderNumber || '',
        e.pickupNumber || '',
        e.amount,
      ]);
      // Color amounts
      const amountCell = row.getCell(6);
      amountCell.font = { color: { argb: e.amount >= 0 ? 'FF059669' : 'FFDC2626' }, bold: true };
    });

    // Summary row
    const total = entries.reduce((s, e) => s + (e.amount || 0), 0);
    const sumRow = ws.addRow(['', '', '', '', 'NET TOTAL', total]);
    sumRow.font = { bold: true };
    sumRow.getCell(6).font = { bold: true, color: { argb: total >= 0 ? 'FF059669' : 'FFDC2626' } };

    // Column widths
    ws.columns = [
      { width: 14 }, { width: 18 }, { width: 40 }, { width: 14 }, { width: 14 }, { width: 16 },
    ];

    const safeName = bizName.replace(/[^a-z0-9]/gi, '_').slice(0, 30);
    const filename = `payout_${safeName}_${String(payout._id).slice(-6)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('export_payoutExcel error:', err);
    res.status(500).json({ success: false, error: 'Failed to export payout' });
  }
};

const addAdjustment = async (req, res) => {
  try {
    const { businessId, amount, note } = req.body;
    if (!businessId || amount === undefined || !note) {
      return res.status(400).json({ success: false, error: 'businessId, amount and note are required' });
    }
    const entry = await ledgerService.createAdjustment(businessId, parseFloat(amount), note);
    res.json({ success: true, entry });
  } catch (err) {
    console.error('addAdjustment error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
};

const get_businessLedgerPage = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id)
      .select('name email brandInfo businessAccountCode profileImage')
      .lean();
    if (!user) return res.status(404).render('404', { message: 'Business not found' });
    const displayName = user.brandInfo?.brandName || user.name || 'Business';
    res.render('admin/business-ledger', {
      businessId: id,
      businessName: displayName,
      businessEmail: user.email || '',
      businessAccountCode: user.businessAccountCode || '',
      profileImage: user.profileImage || '',
      page_title: `${displayName} — Ledger`,
      folder: 'Financial Management',
      breadcrumb: 'Business Ledger',
    });
  } catch (err) {
    console.error('get_businessLedgerPage error:', err);
    res.status(500).send('Server error');
  }
};

const get_businessLedger = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, settled, startDate, endDate, search, page = 1, limit = 50 } = req.query;
    const settledBool = settled === 'true' ? true : settled === 'false' ? false : undefined;

    const oid = new mongoose.Types.ObjectId(id);
    const result = await ledgerService.getEntries(
      oid,
      { type, settled: settledBool, startDate, endDate, search },
      parseInt(page),
      parseInt(limit)
    );
    const balance = await ledgerService.getBalance(oid);
    res.json({ success: true, ...result, balance });
  } catch (err) {
    console.error('get_businessLedger error:', err);
    res.status(500).json({ success: false, error: 'Failed to load ledger' });
  }
};

// Manual trigger for payout processing (admin only)
const runPayoutProcessing = async (req, res) => {
  try {
    const { runPayoutProcessing: run } = require('../jobs/payoutProcessing');
    const businessId = req.body?.businessId || null;
    const result = await run({ businessId });
    if (result?.skipped) {
      return res.json({
        success: false,
        skipped: true,
        reason: result.reason,
        message: result.message || 'Processing is already in progress — please wait.',
      });
    }
    res.json({
      success: true,
      message: result?.message || 'Payout processing completed.',
      businessesProcessed: result?.businessesProcessed ?? 0,
      businessesSkipped: result?.businessesSkipped ?? 0,
      errors: result?.errors ?? [],
    });
  } catch (err) {
    console.error('runPayoutProcessing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};


// ======================================== Businesses ======================================== //

/** Matches User.role values stored in DB (see businessRoleQuery). */
const isBusinessRole = (role) => role === 'business' || role === 'Business';

const get_businessesPage = (req, res) => {
  res.render('admin/businesses', {
    title: 'Businesses',
    page_title: 'Businesses',
    folder: 'Pages',
  });
};

const get_businesses = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      search,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      dateFrom,
      dateTo,
    } = req.query;

    const query = { ...businessRoleFilter(), isCompleted: true };

    // Search functionality
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phoneNumber: searchRegex },
        { 'brandInfo.brandName': searchRegex },
        { 'brandInfo.industry': searchRegex },
      ];
    }

    // Filter by verification status
    if (status === 'verified') {
      query.isVerified = true;
    } else if (status === 'unverified') {
      query.isVerified = false;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const businesses = await User.find(query)
      .select(
        '-password -verificationToken -verificationTokenExpires -verificationOTP -verificationOTPExpires'
      )
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const balanceMap = await getBalances(businesses.map((b) => b._id));

    // Get statistics for each business
    const businessesWithStats = await Promise.all(
      businesses.map(async (business) => {
        const [
          totalOrders,
          completedOrders,
          totalPickups,
          totalShopOrders,
          totalLedgerEntries,
        ] = await Promise.all([
          Order.countDocuments({ business: business._id }),
          Order.countDocuments({
            business: business._id,
            statusCategory: 'SUCCESSFUL',
          }),
          Pickup.countDocuments({ business: business._id }),
          ShopOrder.countDocuments({ business: business._id }),
          LedgerEntry.countDocuments({ business: business._id }),
        ]);

        const successRate =
          totalOrders > 0
            ? ((completedOrders / totalOrders) * 100).toFixed(1)
            : 0;

        const balance = balanceMap.get(business._id.toString()) || 0;

        return {
          ...business,
          balance,
          stats: {
            totalOrders,
            completedOrders,
            totalPickups,
            totalShopOrders,
            totalLedgerEntries,
            successRate,
          },
        };
      })
    );

    const totalCount = await User.countDocuments(query);
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.status(200).json({
      businesses: businessesWithStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Error fetching businesses:', error);
    res.status(500).json({ error: 'Failed to fetch businesses' });
  }
};

const get_businessDetailsPage = async (req, res) => {
  try {
    const { businessId } = req.params;

    const business = await User.findById(businessId)
      .select(
        '-password -verificationToken -verificationTokenExpires -verificationOTP -verificationOTPExpires'
      )
      .lean();

    if (!business || !isBusinessRole(business.role)) {
      return res.status(404).render('auth/auth-404', {
        title: '404',
        page_title: 'Business Not Found',
        folder: 'Pages',
      });
    }

    res.render('admin/business-details', {
      title: business.brandInfo?.brandName || business.name,
      page_title: 'Business Details',
      folder: 'Pages',
      businessId: business._id.toString(),
    });
  } catch (error) {
    console.error('Error loading business details page:', error);
    res.status(500).send('Internal server error');
  }
};

const get_businessDetails = async (req, res) => {
  try {
    const { businessId } = req.params;

    const business = await User.findById(businessId)
      .select(
        '-password -verificationToken -verificationTokenExpires -verificationOTP -verificationOTPExpires'
      )
      .lean();

    if (!business || !isBusinessRole(business.role)) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Get comprehensive statistics
    const [
      orders,
      pickups,
      shopOrders,
      recentLedgerEntries,
      recentPayouts,
      unsettledBalance,
      revenueAgg,
    ] = await Promise.all([
      Order.find({ business: business._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('deliveryMan', 'courierName phoneNumber')
        .lean(),
      Pickup.find({ business: business._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('assignedDriver', 'courierName phoneNumber')
        .lean(),
      ShopOrder.find({ business: business._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('courier', 'courierName phoneNumber')
        .lean(),
      LedgerEntry.find({ business: business._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Payout.find({ business: business._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      getBalance(business._id),
      LedgerEntry.aggregate([
        { $match: { business: business._id } },
        {
          $group: {
            _id: null,
            income: {
              $sum: {
                $cond: [{ $gt: ['$amount', 0] }, '$amount', 0],
              },
            },
            expenses: {
              $sum: {
                $cond: [{ $lt: ['$amount', 0] }, { $multiply: ['$amount', -1] }, 0],
              },
            },
          },
        },
      ]),
    ]);

    const bid = business._id;
    const [
      pendingPayoutCount,
      totalLedgerCount,
      totalPayoutCount,
      orderTotal,
      orderSuccessful,
      orderProcessing,
      orderUnsuccessful,
      orderNew,
      pickupTotal,
      pickupCompleted,
      pickupPending,
      shopTotal,
      shopDelivered,
      shopPending,
    ] = await Promise.all([
      Payout.countDocuments({ business: bid, status: { $in: ['scheduled', 'processing'] } }),
      LedgerEntry.countDocuments({ business: bid }),
      Payout.countDocuments({ business: bid }),
      Order.countDocuments({ business: bid }),
      Order.countDocuments({ business: bid, statusCategory: 'SUCCESSFUL' }),
      Order.countDocuments({ business: bid, statusCategory: 'PROCESSING' }),
      Order.countDocuments({ business: bid, statusCategory: 'UNSUCCESSFUL' }),
      Order.countDocuments({ business: bid, statusCategory: 'NEW' }),
      Pickup.countDocuments({ business: bid }),
      Pickup.countDocuments({ business: bid, picikupStatus: 'completed' }),
      Pickup.countDocuments({
        business: bid,
        picikupStatus: { $in: ['new', 'pendingPickup', 'driverAssigned'] },
      }),
      ShopOrder.countDocuments({ business: bid }),
      ShopOrder.countDocuments({ business: bid, status: 'delivered' }),
      ShopOrder.countDocuments({
        business: bid,
        status: { $in: ['pending', 'confirmed', 'assigned'] },
      }),
    ]);

    // Calculate statistics
    const stats = {
      orders: {
        total: orderTotal,
        successful: orderSuccessful,
        processing: orderProcessing,
        unsuccessful: orderUnsuccessful,
        new: orderNew,
      },
      pickups: {
        total: pickupTotal,
        completed: pickupCompleted,
        pending: pickupPending,
      },
      shopOrders: {
        total: shopTotal,
        delivered: shopDelivered,
        pending: shopPending,
      },
      financial: {
        currentBalance: unsettledBalance,
        totalLedgerEntries: totalLedgerCount,
        totalPayouts: totalPayoutCount,
        pendingReleases: pendingPayoutCount,
      },
    };

    const revenueBreakdown =
      revenueAgg.length > 0
        ? { income: revenueAgg[0].income || 0, expenses: revenueAgg[0].expenses || 0 }
        : { income: 0, expenses: 0 };

    res.status(200).json({
      business: { ...business, balance: unsettledBalance },
      stats,
      revenueBreakdown,
      recentOrders: orders,
      recentPickups: pickups,
      recentShopOrders: shopOrders,
      recentLedgerEntries,
      recentPayouts,
    });
  } catch (error) {
    console.error('Error fetching business details:', error);
    res.status(500).json({ error: 'Failed to fetch business details' });
  }
};

// ======================================== Logout ======================================== //

// ======================================== Tickets ======================================== //
const get_ticketsPage = (req, res) => {
  res.render('admin/tickets', {
    title: 'Tickets',
    page_title: 'Tickets',
    folder: 'Pages',
  });
};

const logOut = (req, res) => {
  req.session.destroy();
  res.clearCookie('token');
  res.redirect('/admin-login');
};

// ================= WaitingAction Admin Overrides ================= //
const adminRetryTomorrow = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.orderStatus !== 'waitingAction')
      return res.status(400).json({ error: 'Order not in waitingAction' });
    order.scheduledRetryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await order.save();
    return res.status(200).json({ message: 'Retry scheduled for tomorrow' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to schedule retry' });
  }
};

const adminRetryScheduled = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { date } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.orderStatus !== 'waitingAction')
      return res.status(400).json({ error: 'Order not in waitingAction' });
    const when = new Date(date);
    if (isNaN(when.getTime()))
      return res.status(400).json({ error: 'Invalid date' });
    order.scheduledRetryAt = when;
    await order.save();
    return res.status(200).json({ message: 'Retry scheduled' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to schedule retry' });
  }
};

const adminReturnToWarehouseFromWaiting = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.orderStatus !== 'waitingAction')
      return res.status(400).json({ error: 'Order not in waitingAction' });

    // Update order status to returnToWarehouse (pre-save appends orderStatusHistory)
    order.orderStatus = 'returnToWarehouse';
    order.statusCategory = 'PROCESSING';
    order.$locals = order.$locals || {};
    order.$locals.nextStatusHistoryNote = 'Moved to return pipeline from waiting action';

    await order.save();
    return res.status(200).json({ message: 'Order moved to return stock' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to move to return stock' });
  }
};

const adminCancelFromWaiting = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.orderStatus !== 'waitingAction')
      return res.status(400).json({ error: 'Order not in waitingAction' });

    // Update order status to canceled (pre-save appends orderStatusHistory)
    order.orderStatus = 'canceled';
    order.statusCategory = 'UNSUCCESSFUL';
    order.$locals = order.$locals || {};
    order.$locals.nextStatusHistoryNote = 'Canceled from waiting action';

    await order.save();
    return res.status(200).json({ message: 'Order canceled' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to cancel order' });
  }
};

const adminCancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.orderStatus === 'canceled') {
      return res.status(400).json({ error: 'Order is already canceled' });
    }

    if (!canAdminCancel(order)) {
      return res.status(400).json({
        error: 'This order cannot be canceled from its current status.',
        currentStatus: order.orderStatus,
        statusLabel: statusHelper.getOrderStatusLabel(order.orderStatus),
      });
    }

    const cancelOutcome = applyBusinessLikeCancellation(order, { canceledBy: 'admin' });
    if (cancelOutcome.result === 'already_in_return') {
      return res.status(400).json({ error: cancelOutcome.message });
    }
    order.$locals = order.$locals || {};
    order.$locals.nextStatusHistoryNote = cancelOutcome.message;
    await order.save();

    if (cancelOutcome.notifyCourier && order.deliveryMan) {
      try {
        const reason =
          cancelOutcome.result === 'exchange_cancel'
            ? 'Exchange order canceled by admin'
            : 'Order canceled by admin before pickup';
        await firebase.sendOrderStatusNotification(
          order.deliveryMan,
          order.orderNumber,
          'canceled',
          {
            cancelledBy: 'Admin',
            cancelledAt: new Date(),
            reason,
          }
        );
      } catch (notificationError) {
        console.error(
          `Failed to send cancellation notification to courier ${order.deliveryMan}:`,
          notificationError
        );
      }
    }

    return res.status(200).json({ message: cancelOutcome.message });
  } catch (error) {
    console.error('Error in adminCancelOrder:', error);
    return res.status(500).json({ error: 'Failed to cancel order' });
  }
};

const changeReturnCourier = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { newCourierId } = req.body;

    if (!newCourierId) {
      return res.status(400).json({ error: 'New courier ID is required' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if this is a return order
    if (order.orderShipping.orderType !== 'Return') {
      return res.status(400).json({ error: 'Order is not a return order' });
    }

    // Check if order is in a state where courier can be changed
    const validStatusesForCourierChange = [
      'returnAssigned',
      'returnPickedUp',
      'headingToYou',
      'returnToBusiness',
    ];
    if (!validStatusesForCourierChange.includes(order.orderStatus)) {
      return res.status(400).json({
        error: `Order status ${order.orderStatus} does not allow courier change`,
      });
    }

    // Verify new courier exists
    const newCourier = await Courier.findById(newCourierId);
    if (!newCourier) {
      return res.status(404).json({ error: 'New courier not found' });
    }

    // Store previous courier info
    const previousCourierId = order.deliveryMan;
    const previousCourier = await Courier.findById(previousCourierId);

    // Update courier assignment
    order.deliveryMan = newCourierId;

    // Add to courier history
    order.courierHistory.push({
      courier: newCourierId,
      assignedAt: new Date(),
      action: 'courier_changed',
      notes: `Courier changed from ${previousCourier?.name || 'Unknown'} to ${
        newCourier.name
      } by admin`,
      previousCourier: previousCourierId,
    });

    // Update relevant stage notes
    if (order.orderStatus === 'returnAssigned') {
      order.orderStages.returnAssigned.notes = `Return order reassigned to courier ${newCourier.name} by admin`;
    } else if (order.orderStatus === 'returnPickedUp') {
      order.orderStages.returnPickedUp.notes = `Return picked up - courier changed to ${newCourier.name} by admin`;
    }

    await order.save();

    return res.status(200).json({
      message: `Return courier changed successfully from ${
        previousCourier?.name || 'Unknown'
      } to ${newCourier.name}`,
    });
  } catch (error) {
    console.error('Error in changeReturnCourier:', error);
    return res.status(500).json({ error: 'Failed to change return courier' });
  }
};

// Courier Tracking Page
const getCourierTrackingPage = (req, res) => {
  res.render('admin/courier-tracking', {
    title: 'Courier Tracking',
    page_title: 'Courier Tracking',
    folder: 'Pages',
    breadcrumb: [
      { title: 'Dashboard', link: '/admin' },
      { title: 'Courier Tracking', active: true },
    ],
  });
};

// Courier Tracking
const courierTracking = (req, res) => {
  res.render('admin/courier-tracking', {
    title: 'Courier Tracking',
    page_title: 'Courier Tracking',
    folder: 'Pages',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  });
};

// Get all courier locations
const getCourierLocations = async (req, res) => {
  try {
    // Get all couriers with location tracking enabled and have a valid location
    const couriers = await Courier.find({
      isLocationTrackingEnabled: true,
      'currentLocation.coordinates.0': { $ne: 0 },
      'currentLocation.coordinates.1': { $ne: 0 },
    }).select(
      'name courierID vehicleType isAvailable currentLocation isLocationTrackingEnabled personalPhoto'
    );

    // Process couriers to add photoUrl
    const processedCouriers = couriers.map((courier) => {
      const courierObj = courier.toObject();
      if (courierObj.personalPhoto) {
        courierObj.photoUrl = `/uploads/couriers/${courierObj.personalPhoto}`;
      }
      return courierObj;
    });
    console.log(processedCouriers);
    res.json({
      success: true,
      couriers: processedCouriers,
    });
  } catch (error) {
    console.error('Error getting courier locations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get courier locations',
      error: error.message,
    });
  }
};

// Get a specific courier's location
const getCourierLocation = async (req, res) => {
  try {
    const courierId = req.params.id;
    const courier = await Courier.findById(courierId).select(
      'name courierID vehicleType isAvailable currentLocation phoneNumber email isLocationTrackingEnabled personalPhoto'
    );

    if (!courier) {
      return res.status(404).json({
        success: false,
        message: 'Courier not found',
      });
    }

    // Add photoUrl if personalPhoto exists
    const courierObj = courier.toObject();
    if (courierObj.personalPhoto) {
      courierObj.photoUrl = `/uploads/couriers/${courierObj.personalPhoto}`;
    }

    res.json({
      success: true,
      courier: courierObj,
    });
  } catch (error) {
    console.error('Error getting courier location:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get courier location',
      error: error.message,
    });
  }
};


// ======================================== SHOP PRODUCT MANAGEMENT ======================================== //

// Get shop products management page
const getShopProductsPage = (req, res) => {
  res.render('admin/shop-products', {
    title: 'Shop Products',
    page_title: 'Shop Products Management',
    folder: 'Shop',
  });
};

// Get all products
const getProducts = async (req, res) => {
  try {
    const {
      category,
      isAvailable,
      search,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const query = {};

    if (category) {
      query.category = category;
    }

    if (isAvailable !== undefined) {
      query.isAvailable = isAvailable === 'true';
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }

    const sortOrder = order === 'desc' ? -1 : 1;
    const sortOptions = { [sortBy]: sortOrder };

    const products = await ShopProduct.find(query)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort(sortOptions);

    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

// Get single product
const getProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await ShopProduct.findById(id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.status(200).json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

// Create product
const createProduct = async (req, res) => {
  try {
    // Parse request body if it's a string (from form submission)
    let data = req.body;
    if (typeof req.body === 'string') {
      data = JSON.parse(req.body);
    }

    // Parse images from JSON string if needed
    let images = [];
    if (data.images) {
      // If images is a JSON string, parse it
      if (typeof data.images === 'string') {
        try {
          images = JSON.parse(data.images);
        } catch (e) {
          console.error('Error parsing images JSON:', e);
          images = [];
        }
      } else {
        // If images is already an array
        images = data.images;
      }
    }

    // Create product data object
    const productData = {
      ...data,
      createdBy: req.adminData._id,
      images: images,
    };

    // Parse specifications if sent as JSON string
    if (typeof productData.specifications === 'string') {
      productData.specifications = JSON.parse(productData.specifications);
    }
    if (typeof productData.specificationsAr === 'string') {
      productData.specificationsAr = JSON.parse(productData.specificationsAr);
    }

    const product = new ShopProduct(productData);
    await product.save();

    res.status(201).json({
      message: 'Product created successfully',
      product,
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
};

// Update product
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Parse request body if it's a string (from form submission)
    let data = req.body;
    if (typeof req.body === 'string') {
      data = JSON.parse(req.body);
    }

    // Parse images from JSON string if needed
    let images = [];
    if (data.images) {
      // If images is a JSON string, parse it
      if (typeof data.images === 'string') {
        try {
          images = JSON.parse(data.images);
        } catch (e) {
          console.error('Error parsing images JSON:', e);
          images = [];
        }
      } else {
        // If images is already an array
        images = data.images;
      }
    }

    const updateData = {
      ...data,
      updatedBy: req.adminData._id,
      images: images,
    };

    // Parse specifications if sent as JSON string
    if (typeof updateData.specifications === 'string') {
      updateData.specifications = JSON.parse(updateData.specifications);
    }
    if (typeof updateData.specificationsAr === 'string') {
      updateData.specificationsAr = JSON.parse(updateData.specificationsAr);
    }

    const product = await ShopProduct.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.status(200).json({
      message: 'Product updated successfully',
      product,
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
};

// Delete product
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await ShopProduct.findByIdAndDelete(id);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Delete product images
    product.images.forEach((imagePath) => {
      const fullPath = path.join(__dirname, '..', 'public', imagePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    });

    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
};

// Bulk update stock
const bulkUpdateStock = async (req, res) => {
  try {
    const { updates } = req.body; // Array of { productId, stock }

    const updatePromises = updates.map(async ({ productId, stock }) => {
      // Set isAvailable based on stock
      const isAvailable = stock > 0;

      // Find the product first
      const product = await ShopProduct.findById(productId);
      if (product) {
        // Log stock change
        console.log(
          `Updating product ${product.name} (${productId}) stock: ${product.stock} -> ${stock} (isAvailable: ${isAvailable})`
        );

        // Update with new values
        return ShopProduct.findByIdAndUpdate(
          productId,
          {
            stock,
            isAvailable,
            updatedBy: req.adminData._id,
          },
          { new: true }
        );
      }
      return null;
    });

    const updatedProducts = await Promise.all(updatePromises);

    res.status(200).json({
      message: 'Stock updated successfully',
      updatedCount: updatedProducts.filter((p) => p !== null).length,
    });
  } catch (error) {
    console.error('Error updating stock:', error);
    res.status(500).json({ error: 'Failed to update stock' });
  }
};

// ======================================== SHOP ORDERS MANAGEMENT ======================================== //

// Get shop orders management page
const getShopOrdersPage = (req, res) => {
  res.render('admin/shop-orders', {
    title: 'Shop Orders',
    page_title: 'Shop Orders Management',
    folder: 'Shop',
  });
};

// Get shop order details page for admin
const getShopOrderDetailsPage = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await ShopOrder.findOne({ _id: id })
      .populate('business', 'brandInfo phone email')
      .populate('courier', 'name phone')
      .populate('items.product')
      .populate('trackingHistory.updatedBy', 'name');

    if (!order) {
      req.flash('error', 'Order not found');
      return res.redirect('/admin/shop/orders');
    }

    // Enhance order with consistent data structure
    const enhancedOrder = {
      ...order.toObject(),
      // Ensure all required fields are present
      orderNumber: order.orderNumber || 'N/A',
      status: order.status || 'pending',
      createdAt: order.createdAt || new Date(),
      contactInfo: order.contactInfo || {},
      orderCustomer: order.orderCustomer || {},
      items: order.items || [],
      trackingHistory: order.trackingHistory || [],
      subtotal: order.subtotal || 0,
      discount: order.discount || 0,
      tax: order.tax || 0,
      deliveryFee: order.deliveryFee || 0,
      totalAmount: order.totalAmount || 0,
    };

    res.render('admin/shop-order-details', {
      title: 'Shop Order Details',
      page_title: 'Order Details',
      folder: 'Shop',
      order: enhancedOrder,
    });
  } catch (error) {
    console.error('Error loading admin shop order details:', error);
    req.flash('error', 'Internal Server Error');
    res.redirect('/admin/shop/orders');
  }
};

// Get all shop orders
const getShopOrders = async (req, res) => {
  try {
    const { status, paymentStatus, business, courier, startDate, endDate } =
      req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (business) {
      query.business = business;
    }

    if (courier) {
      query.courier = courier;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    const orders = await ShopOrder.find(query)
      .populate('business', 'brandInfo email phone')
      .populate('courier', 'name phone')
      .populate('items.product', 'name nameAr images')
      .sort({ createdAt: -1 });

    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching shop orders:', error);
    res.status(500).json({ error: 'Failed to fetch shop orders' });
  }
};

// Get single shop order
const getShopOrder = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`Admin fetching order details for order ID: ${id}`);

    const order = await ShopOrder.findById(id)
      .populate('business', 'brandInfo email phone')
      .populate({
        path: 'courier',
        model: 'courier',
        select: 'name phone',
      })
      .populate('items.product')
      .populate({
        path: 'trackingHistory.updatedBy',
        model: 'users',
        select: 'name',
      });

    if (!order) {
      console.log(`Admin: Order not found for ID: ${id}`);
      return res.status(404).json({ error: 'Order not found' });
    }

    console.log(`Admin: Order found: ${order.orderNumber}`);

    // Enhance order with consistent data structure like business controller
    const enhancedOrder = {
      ...order.toObject(),
      // Ensure all required fields are present
      orderNumber: order.orderNumber || 'N/A',
      status: order.status || 'pending',
      createdAt: order.createdAt || new Date(),
      contactInfo: order.contactInfo || {},
      orderCustomer: order.orderCustomer || {},
      items: order.items || [],
      trackingHistory: order.trackingHistory || [],
      subtotal: order.subtotal || 0,
      discount: order.discount || 0,
      tax: order.tax || 0,
      deliveryFee: order.deliveryFee || 0,
      totalAmount: order.totalAmount || 0,
    };

    res.status(200).json(enhancedOrder);
  } catch (error) {
    console.error('Error fetching shop order:', error);
    res.status(500).json({ error: 'Failed to fetch shop order' });
  }
};

// Update shop order status
const updateShopOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, packagingDetails } = req.body;

    const order = await ShopOrder.findById(id).populate('business');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const previousStatus = order.status;
    order.status = status;
    order.updatedBy = req.adminData._id;
    order.updatedByModel = 'Admin';

    if (notes) {
      order.adminNotes = notes;
    }

    if (packagingDetails) {
      order.packagingDetails = packagingDetails;
    }

    // Set specific timestamps
    if (status === 'ready') {
      order.estimatedDeliveryDate = new Date(
        Date.now() + 2 * 24 * 60 * 60 * 1000
      ); // 2 days
    }

    await order.save();

    // Send push notification to business about shop order status change
    try {
      await firebase.sendShopOrderStatusNotification(
        order.business._id,
        order.orderNumber,
        status,
        {
          previousStatus: previousStatus,
          updatedAt: new Date(),
          updatedBy: 'Admin',
          notes: notes || '',
          packagingDetails: packagingDetails || null,
        }
      );
      console.log(
        `📱 Push notification sent to business ${order.business._id} about shop order ${order.orderNumber} status change to ${status}`
      );
    } catch (notificationError) {
      console.error(
        `❌ Failed to send push notification to business ${order.business._id}:`,
        notificationError
      );
      // Don't fail the status update if notification fails
    }

    res.status(200).json({
      message: 'Order status updated successfully',
      order,
    });
  } catch (error) {
    console.error('Error updating shop order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

// Assign courier to shop order
const assignCourierToShopOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { courierId } = req.body;

    const order = await ShopOrder.findById(id).populate('business');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const courier = await Courier.findById(courierId);

    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    // Check if courier is already assigned to this order
    const alreadyAssigned = order.assignedCouriers.some(
      (ac) => ac.courier.toString() === courierId
    );
    if (alreadyAssigned) {
      return res
        .status(400)
        .json({ error: 'Courier is already assigned to this order' });
    }

    // Add courier to assigned couriers array
    order.assignedCouriers.push({
      courier: courierId,
      courierName: courier.name,
      courierPhone: courier.phoneNumber,
      assignedBy: req.adminData._id,
      assignedByModel: 'Admin',
    });

    // Set primary courier if not set
    if (!order.courier) {
      order.courier = courierId;
      order.courierName = courier.name;
      order.courierPhone = courier.phoneNumber;
    }

    order.status = 'assigned';
    order.assignedAt = new Date();
    order.updatedBy = req.adminData._id;
    order.updatedByModel = 'Admin';

    await order.save();

    // Update courier's assigned shop orders
    await Courier.findByIdAndUpdate(courierId, {
      $addToSet: { assignedShopOrders: order._id },
    });

    // Send push notification to courier about shop order assignment
    try {
      await firebase.sendShopOrderAssignmentNotification(
        courierId,
        order.orderNumber,
        {
          orderId: order._id,
          businessName:
            order.business?.brandInfo?.brandName ||
            order.business?.name ||
            'Business',
          assignedBy: 'Admin',
          totalAmount: order.totalAmount,
        }
      );
      console.log(
        `📱 Push notification sent to courier ${courierId} about shop order assignment ${order.orderNumber}`
      );
    } catch (notificationError) {
      console.error(
        `❌ Failed to send push notification to courier ${courierId}:`,
        notificationError
      );
      // Don't fail the assignment if notification fails
    }

    // Send push notification to business about shop order assignment
    try {
      await firebase.sendShopOrderStatusNotification(
        order.business._id,
        order.orderNumber,
        'assigned',
        {
          courierName: courier.name,
          courierPhone: courier.phoneNumber,
          assignedAt: new Date(),
          assignedBy: 'Admin',
        }
      );
      console.log(
        `📱 Push notification sent to business ${order.business._id} about shop order assignment ${order.orderNumber}`
      );
    } catch (notificationError) {
      console.error(
        `❌ Failed to send push notification to business ${order.business._id}:`,
        notificationError
      );
      // Don't fail the assignment if notification fails
    }

    res.status(200).json({
      message: 'Courier assigned successfully',
      order,
    });
  } catch (error) {
    console.error('Error assigning courier:', error);
    res.status(500).json({ error: 'Failed to assign courier' });
  }
};

// Assign multiple couriers to shop orders
const assignMultipleCouriersToShopOrders = async (req, res) => {
  try {
    const { orderIds, courierId } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'Order IDs are required' });
    }

    if (!courierId) {
      return res.status(400).json({ error: 'Courier ID is required' });
    }

    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const results = [];
    const errors = [];

    for (const orderId of orderIds) {
      try {
        const order = await ShopOrder.findById(orderId);

        if (!order) {
          errors.push({ orderId, error: 'Order not found' });
          continue;
        }

        // Check if courier is already assigned
        const alreadyAssigned = order.assignedCouriers.some(
          (ac) => ac.courier.toString() === courierId
        );
        if (alreadyAssigned) {
          errors.push({ orderId, error: 'Courier already assigned' });
          continue;
        }

        // Add courier to assigned couriers array
        order.assignedCouriers.push({
          courier: courierId,
          courierName: courier.name,
          courierPhone: courier.phoneNumber,
          assignedBy: req.adminData._id,
          assignedByModel: 'Admin',
        });

        // Set primary courier if not set
        if (!order.courier) {
          order.courier = courierId;
          order.courierName = courier.name;
          order.courierPhone = courier.phoneNumber;
        }

        order.status = 'assigned';
        order.assignedAt = new Date();
        order.updatedBy = req.adminData._id;
        order.updatedByModel = 'Admin';

        await order.save();

        // Update courier's assigned shop orders
        await Courier.findByIdAndUpdate(courierId, {
          $addToSet: { assignedShopOrders: order._id },
        });

        results.push({ orderId, success: true });
      } catch (error) {
        console.error(`Error assigning courier to order ${orderId}:`, error);
        errors.push({ orderId, error: error.message });
      }
    }

    res.status(200).json({
      message: `Processed ${orderIds.length} orders`,
      results,
      errors,
      successCount: results.length,
      errorCount: errors.length,
    });
  } catch (error) {
    console.error('Error assigning multiple couriers:', error);
    res.status(500).json({ error: 'Failed to assign couriers' });
  }
};

// Get all couriers for assignment
const getAllCouriers = async (req, res) => {
  try {
    const couriers = await Courier.find({ isActive: true }).select(
      'name phone'
    );
    res.status(200).json(couriers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load couriers' });
  }
};

// Smart Flyer Management
const getPrintSmartFlyersPage = (req, res) => {
  res.render('admin/print-smart-flyers', {
    title: 'Print Smart Flyers',
    page_title: 'Print Smart Flyers',
    folder: 'Tools',
  });
};

// Generate smart flyer barcodes and create PDF
const generateSmartFlyers = async (req, res) => {
  try {
    const { amount, startingNumber, includeLogo } = req.body;
    
    // Validate amount
    if (!amount || amount < 1 || amount > 1000) {
      return res.status(400).json({
        status: 'error',
        message: 'Amount must be between 1 and 1000'
      });
    }

    const bwipjs = require('bwip-js');
    const PDFDocument = require('pdfkit');
    
    // Generate random barcodes (not sequential)
    const barcodes = [];
    const usedBarcodes = new Set(); // Track used barcodes to ensure uniqueness
    
    // Helper function to generate random 14-digit number (never starts with 0)
    const generateRandomBarcode = () => {
      let barcode;
      let attempts = 0;
      const maxAttempts = 100;
      
      do {
        // Generate first digit (1-9, never 0)
        const firstDigit = Math.floor(Math.random() * 9) + 1; // Random 1-9
        // Generate remaining 13 digits
        const remainingDigits = Math.floor(Math.random() * 10000000000000); // Random 13 digits
        barcode = firstDigit.toString() + remainingDigits.toString().padStart(13, '0');
        attempts++;
        
        // If we've tried too many times, use timestamp + random to ensure uniqueness
        if (attempts > maxAttempts) {
          const firstDigit = Math.floor(Math.random() * 9) + 1; // Random 1-9
          const timestamp = Date.now().toString().slice(-10); // Last 10 digits of timestamp
          const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
          barcode = firstDigit + timestamp + random;
        }
      } while (usedBarcodes.has(barcode) && attempts < maxAttempts * 2);
      
      usedBarcodes.add(barcode);
      return barcode;
    };
    
    // Generate random barcodes
    for (let i = 0; i < amount; i++) {
      const barcode = generateRandomBarcode();
      barcodes.push(barcode);
    }

    // Set response headers
    const filename = `smart-flyers-${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Logo path
    const logoPath = path.join(__dirname, '../public/logo.png');
    const hasLogo = fs.existsSync(logoPath);

    // Label dimensions: 100mm x 50mm (converted to points: 1mm = 2.83465 points)
    const labelWidth = 100 * 2.83465;   // 100mm = 283.465 points
    const labelHeight = 50 * 2.83465;   // 50mm = 141.7325 points

    // Create PDF with custom page size
    const doc = new PDFDocument({
      size: [labelWidth, labelHeight],
      margins: 0
    });

    doc.pipe(res);

    for (let i = 0; i < barcodes.length; i++) {
      const barcode = barcodes[i];
      
      // Add new page for each label (except first)
      if (i > 0) {
        doc.addPage({
          size: [labelWidth, labelHeight],
          margins: 0
        });
      }

      // Add padding around entire PDF label
      const pdfPadding = 5; // Padding from each side of the PDF
      const contentAreaX = pdfPadding;
      const contentAreaY = pdfPadding;
      const contentAreaWidth = labelWidth - (2 * pdfPadding);
      const contentAreaHeight = labelHeight - (2 * pdfPadding);

      // Draw border around content area (inside padding)
      doc.rect(contentAreaX, contentAreaY, contentAreaWidth, contentAreaHeight)
         .stroke();

      // Logo dimensions and position (centered at top, with padding from border) - Bigger logo
      const logoPadding = 2; // 2 points padding from border
      const logoSize = 42; // Bigger logo size (increased from 35)
      const logoY = contentAreaY + logoPadding + 5; // Inside content area with padding from top, moved down a little
      // Center the logo horizontally
      const logoX = contentAreaX + (contentAreaWidth - logoSize) / 2; // Centered horizontally
      const logoAreaHeight = logoSize + (2 * logoPadding) + 5; // Total height for logo area (including extra space)

      // Add logo centered at top (no border around logo)
      if (hasLogo) {
        try {
          // Add logo centered with padding from border
          doc.image(logoPath, logoX, logoY, {
            fit: [logoSize, logoSize]
          });
        } catch (err) {
          console.error('Error adding logo:', err);
        }
      }

      // Barcode position - below logo area, centered and bigger (10% increase)
      const barcodeY = contentAreaY + logoAreaHeight + 3; // Start below logo area with small gap
      const barcodeHeight = 44; // Barcode height increased by 10% (40 * 1.1 = 44)
      const barcodeWidth = 165; // Barcode width increased by 10% (150 * 1.1 = 165)
      
      // Center the barcode horizontally
      const barcodeX = contentAreaX + (contentAreaWidth - barcodeWidth) / 2; // Centered
      
      try {
        const barcodeBuffer = await bwipjs.toBuffer({
          bcid: 'code128',
          text: barcode,
          scale: 2, // Smaller scale (reduced from 3)
          height: 10, // Smaller height (reduced from 15)
          includetext: false,
          textxalign: 'center',
        });

        // Use fit to maintain aspect ratio but limit size
        doc.image(barcodeBuffer, barcodeX, barcodeY, {
          fit: [barcodeWidth, barcodeHeight]
        });
      } catch (err) {
        console.error('Error generating barcode:', err);
      }
    }

    doc.end();

    // Store generation info in a simple log (optional - you could save to DB)
    const barcodeRange = `${barcodes[0]} - ${barcodes[barcodes.length - 1]}`;
    console.log(`Generated ${amount} smart flyers: ${barcodeRange}`);

  } catch (error) {
    console.error('Error generating smart flyers:', error);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to generate smart flyers: ' + error.message
      });
    }
  }
};

module.exports = {
  getDashboardPage,
  getAdminDashboardData,
  get_deliveryMenByZone,

  // Orders
  get_ordersPage,
  get_orders,
  get_ordersFilterBusinesses,
  get_orderDetailsPage,

  get_couriersPage,
  get_couriers,
  createCourier,
  updateCourierZones,
  bulkDeactivateCouriers,
  bulkDeleteCouriers,

  get_couriersFollowUp,
  get_courierDetailsPage,

  get_pickupsPage,
  get_pickups,
  get_pickupMenByZone,
  assignPickupMan,
  get_pickupDetailsPage,
  cancelPickup,
  deletePickup,
  get_pickedupOrders,

  // Stock Managment from Pickups
  get_stockManagementPage,
  add_to_stock,
  get_stock_orders,
  get_couriers_by_zone,
  assignCourierToStock,
  courier_received,

  // Stock Managment from Returns
  get_stockReturnsPage,
  getReturnedOrders,
  add_return_to_stock,
  assignCourierToReturn,
  resendReturnOtp,
  assignCourierToReturnToBusiness,
  convertFailedDeliveryToReturn,
  getAllReturnOrders,
  getReturnOrderDetailsAdmin,
  updateReturnInspection,
  updateReturnProcessing,
  return_courier_received,

  // Payouts
  get_payoutsPage,
  search_businessesForPayout,
  get_payouts,
  get_payoutDetail,
  export_payoutExcel,
  markPayoutPaid,
  addAdjustment,
  get_businessLedgerPage,
  get_businessLedger,
  runPayoutProcessing,

  // Businesses
  get_businessesPage,
  get_businesses,
  get_businessDetailsPage,
  get_businessDetails,

  // Tickets
  get_ticketsPage,
  // Logout
  logOut,
  getCourierTrackingPage,
  getCourierLocations,
  getCourierLocation,
  courierTracking,
  adminRetryTomorrow,
  adminRetryScheduled,
  adminReturnToWarehouseFromWaiting,
  adminCancelFromWaiting,
  adminCancelOrder,
  changeReturnCourier,
  assignCourierToReturnToBusiness,
  // Shop Product Management
  getShopProductsPage,
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,

  // Smart Flyers
  getPrintSmartFlyersPage,
  generateSmartFlyers,
  bulkUpdateStock,

  // Shop Orders Management
  getShopOrdersPage,
  getShopOrderDetailsPage,
  getShopOrders,
  getShopOrder,
  updateShopOrderStatus,
  assignCourierToShopOrder,
  assignMultipleCouriersToShopOrders,
  getAllCouriers,
};
