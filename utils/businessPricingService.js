/**
 * Admin-managed per-business custom pricing helpers.
 */
const User = require('../models/user');
const PricingAudit = require('../models/pricingAudit');
const {
  PRICING_CATEGORIES,
  ORDER_TYPES,
  orderBaseFees,
  pickupBaseFees,
  GLOBAL_EXPRESS_FEE,
} = require('./fees');

function isBusinessRole(role) {
  return role === 'business' || role === 'Business';
}

function parseOptionalFee(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('Fee values must be non-negative numbers or empty');
  }
  return num;
}

function normalizePricingInput(body) {
  const enabled = body.enabled === true || body.enabled === 'true';
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  const order = {};
  for (const category of PRICING_CATEGORIES) {
    const src = (body.order && body.order[category]) || {};
    order[category] = {};
    for (const orderType of ORDER_TYPES) {
      order[category][orderType] = parseOptionalFee(src[orderType]);
    }
  }

  return {
    enabled,
    order,
    expressFee: parseOptionalFee(body.expressFee),
    pickupFee: parseOptionalFee(body.pickupFee),
    note,
  };
}

function getGlobalDefaults() {
  return {
    order: orderBaseFees,
    expressFee: GLOBAL_EXPRESS_FEE,
    pickupFee: pickupBaseFees,
  };
}

const LEGACY_BROAD_PRICING_KEYS = ['Alexandria', 'Delta-Canal', 'Upper-RedSea'];

function isLegacyBroadPricingOrder(order) {
  if (!order || typeof order !== 'object') return false;
  return LEGACY_BROAD_PRICING_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(order, key)
  );
}

function snapshotOrderPricing(order) {
  const src = order || {};
  const legacyBroad = isLegacyBroadPricingOrder(src);
  const legacyCairo = src.Cairo || {};
  const out = {};

  for (const category of PRICING_CATEGORIES) {
    out[category] = {};
    for (const orderType of ORDER_TYPES) {
      const direct = src[category]?.[orderType];
      if (direct != null) {
        out[category][orderType] = direct;
      } else if (legacyBroad) {
        out[category][orderType] = legacyCairo[orderType] ?? null;
      } else {
        out[category][orderType] = null;
      }
    }
  }

  return out;
}

function snapshotPricing(pricing) {
  const src = pricing || {};
  return {
    enabled: !!src.enabled,
    order: snapshotOrderPricing(src.order),
    expressFee: src.expressFee ?? null,
    pickupFee: src.pickupFee ?? null,
  };
}

function buildPricingDiffs(oldSnap, newSnap, note) {
  const diffs = [];

  if (oldSnap.enabled !== newSnap.enabled) {
    diffs.push({
      field: 'enabled',
      oldValue: oldSnap.enabled,
      newValue: newSnap.enabled,
      note: note || null,
    });
  }

  for (const category of PRICING_CATEGORIES) {
    for (const orderType of ORDER_TYPES) {
      const field = `order.${category}.${orderType}`;
      const oldVal = oldSnap.order[category][orderType];
      const newVal = newSnap.order[category][orderType];
      if (oldVal !== newVal) {
        diffs.push({ field, oldValue: oldVal, newValue: newVal, note: note || null });
      }
    }
  }

  for (const field of ['expressFee', 'pickupFee']) {
    if (oldSnap[field] !== newSnap[field]) {
      diffs.push({
        field,
        oldValue: oldSnap[field],
        newValue: newSnap[field],
        note: note || null,
      });
    }
  }

  return diffs;
}

async function getBusinessPricing(businessId) {
  const business = await User.findById(businessId)
    .select('role customPricing brandInfo name parentCompany')
    .populate('parentCompany', 'name brandInfo businessAccountCode customPricing')
    .lean();

  if (!business || !isBusinessRole(business.role)) {
    const err = new Error('Business not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const auditHistory = await PricingAudit.find({ business: businessId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const parentCompany = business.parentCompany || null;
  const pricingInheritedFromParent = Boolean(parentCompany);

  return {
    businessId: business._id.toString(),
    businessName: business.brandInfo?.brandName || business.name,
    customPricing: snapshotPricing(business.customPricing),
    globalDefaults: getGlobalDefaults(),
    auditHistory,
    pricingInheritedFromParent,
    parentCompany: parentCompany
      ? {
          id: parentCompany._id,
          name: parentCompany.brandInfo?.brandName || parentCompany.name,
          businessAccountCode: parentCompany.businessAccountCode || null,
        }
      : null,
    inheritedPricing: pricingInheritedFromParent
      ? snapshotPricing(parentCompany.customPricing)
      : null,
  };
}

async function updateBusinessPricing(businessId, body, adminData) {
  const business = await User.findById(businessId).select('role customPricing parentCompany');

  if (!business || !isBusinessRole(business.role)) {
    const err = new Error('Business not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (business.parentCompany) {
    const err = new Error(
      'This sub-business inherits pricing from its parent company. Edit pricing on the parent company account instead.'
    );
    err.code = 'PRICING_INHERITED';
    throw err;
  }

  const normalized = normalizePricingInput(body);
  const oldSnap = snapshotPricing(business.customPricing);
  const newSnap = {
    enabled: normalized.enabled,
    order: normalized.order,
    expressFee: normalized.expressFee,
    pickupFee: normalized.pickupFee,
  };

  const diffs = buildPricingDiffs(oldSnap, newSnap, normalized.note);
  if (diffs.length === 0) {
    return {
      customPricing: snapshotPricing(business.customPricing),
      globalDefaults: getGlobalDefaults(),
      changed: false,
    };
  }

  const adminName = adminData?.name || adminData?.email || 'Admin';
  const now = new Date();

  business.customPricing = {
    ...newSnap,
    updatedBy: adminData._id,
    updatedByName: adminName,
    updatedAt: now,
  };

  await business.save();

  await PricingAudit.insertMany(
    diffs.map((d) => ({
      business: businessId,
      changedBy: adminData._id,
      changedByName: adminName,
      field: d.field,
      oldValue: d.oldValue,
      newValue: d.newValue,
      note: d.note,
    }))
  );

  const auditHistory = await PricingAudit.find({ business: businessId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return {
    customPricing: snapshotPricing(business.customPricing),
    globalDefaults: getGlobalDefaults(),
    auditHistory,
    changed: true,
  };
}

module.exports = {
  getBusinessPricing,
  updateBusinessPricing,
  getGlobalDefaults,
  snapshotPricing,
  normalizePricingInput,
};
