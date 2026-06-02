const crypto = require('crypto');
const bcrypt = require('bcrypt');
const User = require('../models/user');
const Order = require('../models/order');
const Pickup = require('../models/pickup');
const ShopOrder = require('../models/shopOrder');
const Ticket = require('../models/ticket');
const TicketMessage = require('../models/ticketMessage');
const Notification = require('../models/notification');
const LedgerEntry = require('../models/ledgerEntry');
const Payout = require('../models/payout');
const ShopifyInstallation = require('../models/shopifyInstallation');
const WoocommerceInstallation = require('../models/woocommerceInstallation');
const WoocommercePairingGrant = require('../models/woocommercePairingGrant');
const ShopifySyncLog = require('../models/shopifySyncLog');
const WoocommerceSyncLog = require('../models/woocommerceSyncLog');
const {
  AssistantConversation,
  AssistantPreferences,
} = require('../models/assistant');
const BusinessDeletionAudit = require('../models/businessDeletionAudit');
const { getBalance } = require('./ledgerService');
const { encryptToken } = require('./shopifyTokenCrypto');

const ORDER_TERMINAL_STATUSES = [
  'completed',
  'returned',
  'canceled',
  'returnCompleted',
];

const PICKUP_TERMINAL_STATUSES = [
  'pickedUp',
  'completed',
  'canceled',
  'rejected',
  'returned',
  'terminated',
];

const TICKET_CLOSED_STATUSES = ['resolved', 'closed'];

function isBusinessRole(role) {
  return role === 'business' || role === 'Business';
}

async function loadBusinessOrThrow(businessId) {
  const business = await User.findById(businessId);
  if (!business || !isBusinessRole(business.role)) {
    const err = new Error('Business not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (business.isDeleted) {
    const err = new Error('Business is already removed');
    err.code = 'ALREADY_DELETED';
    throw err;
  }
  return business;
}

async function disconnectIntegrations(businessId) {
  const bid = businessId;
  await ShopifyInstallation.updateMany(
    { business: bid, uninstalledAt: null },
    {
      $set: {
        uninstalledAt: new Date(),
        isActive: false,
        accessTokenEncrypted: '',
        refreshTokenEncrypted: null,
      },
    }
  );
  await WoocommerceInstallation.updateMany(
    { business: bid, uninstalledAt: null },
    {
      $set: {
        uninstalledAt: new Date(),
        isActive: false,
        installationTokenDigest: `uninstalled_${crypto.randomBytes(16).toString('hex')}`,
        sharedSecretEncrypted: encryptToken('revoked'),
        restKeyEncrypted: null,
        restSecretEncrypted: null,
      },
    }
  );
  await WoocommercePairingGrant.deleteMany({ business: bid });
}

async function deactivateAssistant(businessId) {
  await AssistantConversation.updateMany(
    { user: businessId },
    { $set: { isActive: false } }
  );
  await AssistantPreferences.updateMany(
    { user: businessId },
    { $set: { enabled: false } }
  );
}

async function writeDeletionAudit(
  business,
  adminId,
  mode,
  reason,
  countsDeleted = {},
  snapshot = {}
) {
  return BusinessDeletionAudit.create({
    businessId: business._id,
    originalName: snapshot.originalName || business.originalName || business.name,
    originalBrandName:
      snapshot.originalBrandName ||
      business.originalBrandName ||
      business.brandInfo?.brandName ||
      null,
    originalEmail: snapshot.originalEmail || business.email,
    businessAccountCode:
      snapshot.businessAccountCode ?? business.businessAccountCode ?? null,
    mode,
    reason,
    deletedBy: adminId,
    countsDeleted,
  });
}

/**
 * Impact report for admin confirmation UI.
 */
async function getDeletionImpact(businessId) {
  const business = await User.findById(businessId)
    .select(
      'name email phoneNumber brandInfo businessAccountCode createdAt isDeleted role isVerified'
    )
    .lean();

  if (!business || !isBusinessRole(business.role)) {
    const err = new Error('Business not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (business.isDeleted) {
    const err = new Error('Business is already removed');
    err.code = 'ALREADY_DELETED';
    throw err;
  }

  const bid = business._id;

  const [
    balance,
    pendingPayouts,
    totalOrders,
    activeOrders,
    totalPickups,
    pendingPickups,
    totalShopOrders,
    openTickets,
    totalLedgerEntries,
    totalPayouts,
    totalNotifications,
    shopifyConnected,
    wooConnected,
  ] = await Promise.all([
    getBalance(bid),
    Payout.countDocuments({ business: bid, status: { $in: ['scheduled', 'processing'] } }),
    Order.countDocuments({ business: bid }),
    Order.countDocuments({
      business: bid,
      orderStatus: { $nin: ORDER_TERMINAL_STATUSES },
    }),
    Pickup.countDocuments({ business: bid }),
    Pickup.countDocuments({
      business: bid,
      picikupStatus: { $nin: PICKUP_TERMINAL_STATUSES },
    }),
    ShopOrder.countDocuments({ business: bid }),
    Ticket.countDocuments({
      business: bid,
      status: { $nin: TICKET_CLOSED_STATUSES },
    }),
    LedgerEntry.countDocuments({ business: bid }),
    Payout.countDocuments({ business: bid }),
    Notification.countDocuments({ recipient: bid }),
    ShopifyInstallation.exists({ business: bid, uninstalledAt: null }),
    WoocommerceInstallation.exists({ business: bid, uninstalledAt: null }),
  ]);

  const blockReasons = [];
  if (balance !== 0) {
    blockReasons.push(
      `Wallet balance is ${balance.toFixed(2)} EGP (must be zero before removal).`
    );
  }
  if (pendingPayouts > 0) {
    blockReasons.push(
      `${pendingPayouts} payout(s) are scheduled or processing — resolve before removal.`
    );
  }

  const warnings = [];
  if (activeOrders > 0) {
    warnings.push(`${activeOrders} order(s) are still in active (non-terminal) status.`);
  }
  if (pendingPickups > 0) {
    warnings.push(`${pendingPickups} pickup(s) are still pending or in progress.`);
  }
  if (openTickets > 0) {
    warnings.push(`${openTickets} support ticket(s) are still open.`);
  }

  return {
    business: {
      id: bid.toString(),
      name: business.name,
      brandName: business.brandInfo?.brandName || null,
      email: business.email,
      phoneNumber: business.phoneNumber,
      businessAccountCode: business.businessAccountCode,
      createdAt: business.createdAt,
      isVerified: business.isVerified,
    },
    financial: {
      balance,
      pendingPayouts,
      totalLedgerEntries,
      totalPayouts,
    },
    operations: {
      totalOrders,
      activeOrders,
      totalPickups,
      pendingPickups,
      totalShopOrders,
      openTickets,
      totalNotifications,
    },
    integrations: {
      shopifyConnected: Boolean(shopifyConnected),
      wooConnected: Boolean(wooConnected),
    },
    hardBlock: blockReasons.length > 0,
    blockReasons,
    warnings,
  };
}

async function softDeleteBusiness(businessId, adminId, reason) {
  const business = await loadBusinessOrThrow(businessId);
  const impact = await getDeletionImpact(businessId);
  if (impact.hardBlock) {
    const err = new Error(impact.blockReasons.join(' '));
    err.code = 'HARD_BLOCK';
    err.blockReasons = impact.blockReasons;
    throw err;
  }

  const originalName = business.name;
  const originalBrandName = business.brandInfo?.brandName || null;
  const originalEmail = business.email;
  const originalAccountCode = business.businessAccountCode || null;
  const idStr = business._id.toString();

  const randomPassword = await bcrypt.hash(
    crypto.randomBytes(32).toString('hex'),
    10
  );

  business.originalName = originalName;
  business.originalBrandName = originalBrandName;
  business.isDeleted = true;
  business.deletedAt = new Date();
  business.deletedBy = adminId;
  business.deletionReason = reason;
  business.name = '[Removed Business]';
  business.email = `deleted_${idStr}@removed.local`;
  business.phoneNumber = `DELETED_${idStr}`;
  business.password = randomPassword;
  business.profileImage = null;
  business.fcmToken = null;
  business.verificationToken = undefined;
  business.verificationTokenExpires = undefined;
  business.verificationOTP = undefined;
  business.verificationOTPExpires = undefined;
  business.businessAccountCode = null;
  if (business.brandInfo) {
    business.brandInfo.brandName = originalBrandName || originalName;
  }
  if (business.brandType?.brandDetails?.photos) {
    business.brandType.brandDetails.photos = [];
  }

  await business.save();
  await disconnectIntegrations(business._id);
  await deactivateAssistant(business._id);
  await writeDeletionAudit(business, adminId, 'soft', reason, {}, {
    originalName,
    originalBrandName,
    originalEmail,
    businessAccountCode: originalAccountCode,
  });

  return {
    mode: 'soft',
    businessId: idStr,
    displayName: `Removed — ${originalBrandName || originalName}`,
  };
}

async function cascadeDeleteOperationalData(businessId) {
  const bid = businessId;
  const ticketIds = await Ticket.find({ business: bid }).distinct('_id');

  const counts = {
    orders: 0,
    pickups: 0,
    shopOrders: 0,
    tickets: 0,
    ticketMessages: 0,
    notifications: 0,
    shopifyInstallations: 0,
    wooInstallations: 0,
    wooPairingGrants: 0,
    shopifySyncLogs: 0,
    wooSyncLogs: 0,
    assistantConversations: 0,
    assistantPreferences: 0,
  };

  if (ticketIds.length) {
    const msgResult = await TicketMessage.deleteMany({ ticket: { $in: ticketIds } });
    counts.ticketMessages = msgResult.deletedCount || 0;
  }

  const [
    ordersR,
    pickupsR,
    shopR,
    ticketsR,
    notifR,
    shopifyR,
    wooR,
    grantsR,
    shopLogR,
    wooLogR,
    convR,
    prefR,
  ] = await Promise.all([
    Order.deleteMany({ business: bid }),
    Pickup.deleteMany({ business: bid }),
    ShopOrder.deleteMany({ business: bid }),
    Ticket.deleteMany({ business: bid }),
    Notification.deleteMany({ recipient: bid }),
    ShopifyInstallation.deleteMany({ business: bid }),
    WoocommerceInstallation.deleteMany({ business: bid }),
    WoocommercePairingGrant.deleteMany({ business: bid }),
    ShopifySyncLog.deleteMany({ business: bid }),
    WoocommerceSyncLog.deleteMany({ business: bid }),
    AssistantConversation.deleteMany({ user: bid }),
    AssistantPreferences.deleteMany({ user: bid }),
  ]);

  counts.orders = ordersR.deletedCount || 0;
  counts.pickups = pickupsR.deletedCount || 0;
  counts.shopOrders = shopR.deletedCount || 0;
  counts.tickets = ticketsR.deletedCount || 0;
  counts.notifications = notifR.deletedCount || 0;
  counts.shopifyInstallations = shopifyR.deletedCount || 0;
  counts.wooInstallations = wooR.deletedCount || 0;
  counts.wooPairingGrants = grantsR.deletedCount || 0;
  counts.shopifySyncLogs = shopLogR.deletedCount || 0;
  counts.wooSyncLogs = wooLogR.deletedCount || 0;
  counts.assistantConversations = convR.deletedCount || 0;
  counts.assistantPreferences = prefR.deletedCount || 0;

  return counts;
}

async function cascadeDeleteBusiness(businessId, adminId, reason) {
  const business = await loadBusinessOrThrow(businessId);
  const impact = await getDeletionImpact(businessId);
  if (impact.hardBlock) {
    const err = new Error(impact.blockReasons.join(' '));
    err.code = 'HARD_BLOCK';
    err.blockReasons = impact.blockReasons;
    throw err;
  }

  const originalName = business.name;
  const originalBrandName = business.brandInfo?.brandName || null;
  const originalEmail = business.email;
  const originalAccountCode = business.businessAccountCode || null;
  const idStr = business._id.toString();

  const countsDeleted = await cascadeDeleteOperationalData(business._id);
  await writeDeletionAudit(business, adminId, 'cascade', reason, countsDeleted, {
    originalName,
    originalBrandName,
    originalEmail,
    businessAccountCode: originalAccountCode,
  });
  await User.deleteOne({ _id: business._id });

  return {
    mode: 'cascade',
    businessId: idStr,
    displayName: `Removed — ${originalBrandName || originalName}`,
    countsDeleted,
  };
}

module.exports = {
  getDeletionImpact,
  softDeleteBusiness,
  cascadeDeleteBusiness,
  isBusinessRole,
  ORDER_TERMINAL_STATUSES,
  PICKUP_TERMINAL_STATUSES,
};
