// Centralized fee config and helpers (orders + pickups)

const {
  METRO_GOVERNORATE_KEYS,
  normalizeGovKey,
} = require('./deliveryZonesBosta');

/** Per-governorate pricing keys — same as Create order (Cairo, Giza, Qalyubia). */
const PRICING_CATEGORIES = [...METRO_GOVERNORATE_KEYS];
const ORDER_TYPES = ['Deliver', 'Return', 'Exchange'];

/** @deprecated Broad fee regions — kept for Shopify / import helpers that list legacy labels. */
const governmentCategories = {
  Cairo: ['Cairo', 'Giza', 'Qalyubia'],
  Alexandria: ['Alexandria', 'Beheira', 'Matrouh'],
  'Delta-Canal': [
    'Dakahlia', 'Sharqia', 'Monufia', 'Gharbia',
    'Kafr el-Sheikh', 'Damietta', 'Port Said', 'Ismailia', 'Suez',
  ],
  'Upper-RedSea': [
    'Fayoum', 'Beni Suef', 'Minya', 'Asyut',
    'Sohag', 'Qena', 'Luxor', 'Aswan', 'Red Sea',
    'North Sinai', 'South Sinai', 'New Valley',
  ],
};

const orderBaseFees = Object.fromEntries(
  PRICING_CATEGORIES.map((gov) => [gov, { Deliver: 100, Return: 100, Exchange: 100 }])
);

const pickupBaseFees = Object.fromEntries(
  PRICING_CATEGORIES.map((gov) => [gov, 100])
);

const GLOBAL_EXPRESS_FEE = 200;

function resolveCategoryByCity(city) {
  const key = normalizeGovKey(city);
  if (key && PRICING_CATEGORIES.includes(key)) return key;
  return 'Cairo';
}

/**
 * Normalize a business document (or plain object) into a pricing context.
 * Returns null when custom pricing is not enabled.
 */
function resolveBusinessPricing(businessDoc) {
  if (!businessDoc || !businessDoc.customPricing) return null;
  const pricing = businessDoc.customPricing;
  if (!pricing.enabled) return null;
  return pricing;
}

function isValidFeeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function getGlobalOrderFee(category, orderType, isExpressShipping) {
  if (isExpressShipping) return GLOBAL_EXPRESS_FEE;
  return orderBaseFees[category]?.[orderType] || 0;
}

function getGlobalPickupFee(city) {
  const category = resolveCategoryByCity(city);
  return pickupBaseFees[category] ?? 100;
}

function calculateOrderFee(city, orderType, isExpressShipping, pricing) {
  const category = resolveCategoryByCity(city);
  const ctx = pricing || null;

  if (ctx && ctx.enabled) {
    if (isExpressShipping) {
      if (isValidFeeNumber(ctx.expressFee)) {
        return ctx.expressFee;
      }
      // Express orders never use per-category rates — fall back to global express.
    } else {
      const customCategory = ctx.order && ctx.order[category];
      const customFee = customCategory && customCategory[orderType];
      if (isValidFeeNumber(customFee)) {
        return customFee;
      }
    }
  }

  return getGlobalOrderFee(category, orderType, isExpressShipping);
}

function calculatePickupFee(city, pickedCount, pricing) {
  const ctx = pricing || null;
  if (ctx && ctx.enabled && isValidFeeNumber(ctx.pickupFee)) {
    return ctx.pickupFee;
  }
  return getGlobalPickupFee(city);
}

module.exports = {
  PRICING_CATEGORIES,
  ORDER_TYPES,
  governmentCategories,
  resolveCategoryByCity,
  resolveBusinessPricing,
  calculateOrderFee,
  calculatePickupFee,
  orderBaseFees,
  pickupBaseFees,
  GLOBAL_EXPRESS_FEE,
};
