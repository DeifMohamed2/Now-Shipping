/**
 * ledgerService.js
 *
 * All financial logic lives here. Controllers and model hooks call these
 * functions — nothing writes directly to LedgerEntry except this service.
 */

const LedgerEntry = require('../models/ledgerEntry');
const { calculateOrderFee } = require('./fees');

// ─────────────────────────────────────────────────────────────
// Order events
// ─────────────────────────────────────────────────────────────

/**
 * Called automatically by the Order post-save hook when an order
 * reaches a terminal financial status.
 *
 * Idempotent: the unique index on { orderId, type } means re-running
 * this for the same order is safe — duplicate writes are silently ignored.
 *
 * Logic is branched on BOTH orderType and orderStatus so that a Deliver
 * order later transitioning to 'returned' never picks up a "Return fee"
 * (only Return-type orders get that row).
 *
 * Every entry includes an immutable snapshot of order fields captured at
 * write time so the row remains meaningful even if the order is later
 * edited or hard-deleted by an admin.
 */
async function createOrderEntries(order) {
  const { orderStatus, orderShipping, orderFees, business, _id, orderNumber } = order;
  const entries = [];

  // ── Compute the fee once, snapshotted at this moment ───────────────
  // orderFees is set by the courier/system before the status flip; fall
  // back to the rate table only if it hasn't been set yet.
  const fee = (orderFees > 0)
    ? orderFees
    : calculateOrderFee(
        order.orderCustomer.government,
        orderShipping.orderType,
        orderShipping.isExpressShipping
      );

  // ── Shared snapshot payload (immutable — never mutated after write) ─
  const snap = {
    business,
    orderId: _id,
    orderNumber,
    createdBy: 'system',
    orderTypeSnapshot: orderShipping.orderType || null,
    amountTypeSnapshot: orderShipping.amountType || null,
    orderAmountSnapshot: orderShipping.amount || 0,
    feeAmountSnapshot: fee || 0,
    governmentSnapshot: (order.orderCustomer && order.orderCustomer.government) || null,
    zoneSnapshot: (order.orderCustomer && order.orderCustomer.zone) || null,
    customerNameSnapshot: (order.orderCustomer && order.orderCustomer.fullName) || null,
    originalOrderNumberSnapshot: orderShipping.originalOrderNumber || null,
  };

  // ── DELIVER orders ─────────────────────────────────────────────────
  if (orderShipping.orderType === 'Deliver') {
    if (orderStatus === 'completed') {
      // 1. COD collected from customer (credit to the business)
      if (orderShipping.amountType === 'COD' && orderShipping.amount > 0) {
        entries.push({
          ...snap,
          type: 'cod_collected',
          amount: orderShipping.amount,
          description: `Order ${orderNumber} delivered — COD collected`,
        });
      }

      // 2. Delivery fee (debit to the business)
      if (fee > 0) {
        entries.push({
          ...snap,
          type: 'delivery_fee',
          amount: -fee,
          description: `Delivery fee — Order ${orderNumber}`,
        });
      }
    }
    // Deliver + 'returned': the order was returned after being completed or
    // refused on first attempt. The delivery_fee row (written at 'completed')
    // or no row at all (never delivered) is the correct state — we do NOT
    // add a separate "Return fee" for Deliver-type orders. The unique index
    // already protects the existing row from being double-written.
    // Deliver + 'canceled': charge only if the courier already picked it up.
    if (orderStatus === 'canceled' && fee > 0) {
      entries.push({
        ...snap,
        type: 'delivery_fee',
        amount: -fee,
        description: `Cancellation fee — Order ${orderNumber}`,
      });
    }
  }

  // ── RETURN orders ──────────────────────────────────────────────────
  if (orderShipping.orderType === 'Return') {
    if (orderStatus === 'returned' || orderStatus === 'returnCompleted') {
      // Return-type orders always use 'Return' rate, not the original order's fee.
      const returnFee = (orderFees > 0)
        ? orderFees
        : calculateOrderFee(order.orderCustomer.government, 'Return', false);

      if (returnFee > 0) {
        entries.push({
          ...snap,
          type: 'delivery_fee',
          amount: -returnFee,
          feeAmountSnapshot: returnFee,
          description: `Return fee — Order ${orderNumber}`,
        });
      }
    }

    if (orderStatus === 'canceled' && fee > 0) {
      entries.push({
        ...snap,
        type: 'delivery_fee',
        amount: -fee,
        description: `Cancellation fee — Order ${orderNumber}`,
      });
    }
  }

  // ── EXCHANGE orders ────────────────────────────────────────────────
  if (orderShipping.orderType === 'Exchange') {
    if (orderStatus === 'completed') {
      // Cash Difference collected from the customer (credit to the business)
      if (orderShipping.amountType === 'CD' && orderShipping.amount > 0) {
        entries.push({
          ...snap,
          type: 'cash_difference_collected',
          amount: orderShipping.amount,
          description: `Order ${orderNumber} exchange — cash difference collected`,
        });
      }

      // Exchange delivery/service fee (debit to the business)
      if (fee > 0) {
        entries.push({
          ...snap,
          type: 'delivery_fee',
          amount: -fee,
          description: `Delivery fee — Order ${orderNumber}`,
        });
      }
    }

    if (orderStatus === 'canceled' && fee > 0) {
      entries.push({
        ...snap,
        type: 'delivery_fee',
        amount: -fee,
        description: `Cancellation fee — Order ${orderNumber}`,
      });
    }
  }

  if (entries.length === 0) return;

  // insertMany with ordered:false so partial duplicates don't abort the batch
  try {
    await LedgerEntry.insertMany(entries, { ordered: false });
  } catch (err) {
    // Duplicate key errors (code 11000) are safe to ignore — idempotency
    if (err.code !== 11000 && err.writeErrors) {
      const realErrors = (err.writeErrors || []).filter(e => e.code !== 11000);
      if (realErrors.length > 0) {
        console.error('ledgerService.createOrderEntries write errors:', realErrors);
      }
    } else if (err.code !== 11000) {
      console.error('ledgerService.createOrderEntries error:', err);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Pickup events
// ─────────────────────────────────────────────────────────────

/**
 * Call when a pickup is collected from the business (`picikupStatus === 'pickedUp'`).
 * The unique { pickupId, type } index keeps this idempotent on re-saves.
 */
async function createPickupEntry(pickup) {
  const { business, _id, pickupNumber, pickupFees } = pickup;
  if (!pickupFees || pickupFees <= 0) return;

  try {
    await LedgerEntry.create({
      business,
      type: 'pickup_fee',
      amount: -pickupFees,
      description: `Pickup fee — ${pickupNumber} (collected from business)`,
      pickupId: _id,
      pickupNumber,
      createdBy: 'system',
    });
  } catch (err) {
    if (err.code !== 11000) {
      console.error('ledgerService.createPickupEntry error:', err);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Balance
// ─────────────────────────────────────────────────────────────

/**
 * Compute the current unsettled balance for a business.
 * Only entries without a payoutId count (i.e. not yet included in a payout).
 */
async function getBalance(businessId) {
  const result = await LedgerEntry.aggregate([
    { $match: { business: businessId, payoutId: null } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return result.length > 0 ? result[0].total : 0;
}

/**
 * Compute balances for multiple businesses at once.
 * Returns a Map of businessId string → balance number.
 */
async function getBalances(businessIds) {
  const results = await LedgerEntry.aggregate([
    { $match: { business: { $in: businessIds }, payoutId: null } },
    { $group: { _id: '$business', total: { $sum: '$amount' } } },
  ]);
  const map = new Map();
  for (const row of results) {
    map.set(row._id.toString(), row.total);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// Entry queries
// ─────────────────────────────────────────────────────────────

/**
 * Paginated ledger entries for a business with optional filters.
 *
 * filters: { type, settled, startDate, endDate, search }
 */
async function getEntries(businessId, filters = {}, page = 1, limit = 50) {
  const query = { business: businessId };

  if (filters.type && filters.type !== 'all') {
    query.type = filters.type;
  }

  if (filters.settled === true) {
    query.payoutId = { $ne: null };
  } else if (filters.settled === false) {
    query.payoutId = null;
  }

  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  if (filters.search) {
    query.$or = [
      { description: { $regex: filters.search, $options: 'i' } },
      { orderNumber: { $regex: filters.search, $options: 'i' } },
      { pickupNumber: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const skip = (page - 1) * limit;
  const [entries, total] = await Promise.all([
    LedgerEntry.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('payoutId', 'status scheduledDate paidDate')
      .lean(),
    LedgerEntry.countDocuments(query),
  ]);

  return { entries, total, page, pages: Math.ceil(total / limit) };
}

// ─────────────────────────────────────────────────────────────
// Admin manual adjustment
// ─────────────────────────────────────────────────────────────

/**
 * Create a manual adjustment entry (admin only).
 * amount > 0 = credit to business, amount < 0 = debit from business.
 */
async function createAdjustment(businessId, amount, note) {
  if (!note || note.trim() === '') {
    throw new Error('Admin note is required for adjustments');
  }
  return LedgerEntry.create({
    business: businessId,
    type: 'adjustment',
    amount,
    description: `Admin adjustment: ${note.trim()}`,
    createdBy: 'admin',
    adminNote: note.trim(),
  });
}

// ─────────────────────────────────────────────────────────────
// Payout helpers
// ─────────────────────────────────────────────────────────────

/**
 * Mark all unsettled entries for a business as settled under a payout,
 * and write the balancing payout debit entry.
 *
 * Called by the payout cron job only.
 */
async function settleEntriesForPayout(businessId, payoutId, payoutAmount) {
  // Link all unsettled entries to this payout
  await LedgerEntry.updateMany(
    { business: businessId, payoutId: null },
    { $set: { payoutId } }
  );

  // Write the balancing debit entry
  await LedgerEntry.create({
    business: businessId,
    type: 'payout',
    amount: -payoutAmount,
    description: `Weekly payout`,
    payoutId,
    createdBy: 'system',
  });
}

// ─────────────────────────────────────────────────────────────
// Utility: next Wednesday date
// ─────────────────────────────────────────────────────────────

function nextWednesday(fromDate = new Date()) {
  const d = new Date(fromDate);
  const day = d.getDay(); // 0=Sun … 3=Wed … 6=Sat
  const daysUntil = day === 3 ? 7 : (3 - day + 7) % 7;
  d.setDate(d.getDate() + daysUntil);
  d.setHours(0, 0, 0, 0);
  return d;
}

module.exports = {
  createOrderEntries,
  createPickupEntry,
  getBalance,
  getBalances,
  getEntries,
  createAdjustment,
  settleEntriesForPayout,
  nextWednesday,
};
