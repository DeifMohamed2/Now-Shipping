// Centralized fee config and helpers (orders + pickups)

const PRICING_CATEGORIES = ['Cairo', 'Alexandria', 'Delta-Canal', 'Upper-RedSea'];
const ORDER_TYPES = ['Deliver', 'Return', 'Exchange'];

const governmentCategories = {
  'Cairo': ['Cairo', 'Giza', 'Qalyubia'],
  'Alexandria': ['Alexandria', 'Beheira', 'Matrouh'],
  'Delta-Canal': [
    'Dakahlia', 'Sharqia', 'Monufia', 'Gharbia',
    'Kafr el-Sheikh', 'Damietta', 'Port Said', 'Ismailia', 'Suez'
  ],
  'Upper-RedSea': [
    'Fayoum', 'Beni Suef', 'Minya', 'Asyut',
    'Sohag', 'Qena', 'Luxor', 'Aswan', 'Red Sea',
    'North Sinai', 'South Sinai', 'New Valley'
  ]
};

const orderBaseFees = {
  'Cairo': { Deliver: 100, Return: 100, Exchange: 100 },
  'Alexandria': { Deliver: 100, Return: 100, Exchange: 100 },
  'Delta-Canal': { Deliver: 100, Return: 100, Exchange: 100 },
  'Upper-RedSea': { Deliver: 100, Return: 100, Exchange: 100 },
};

const pickupBaseFees = {
  'Cairo': 100,
  'Alexandria': 100,
  'Delta-Canal': 100,
  'Upper-RedSea': 100,
};

const GLOBAL_EXPRESS_FEE = 200;

function resolveCategoryByCity(city) {
  let category = 'Cairo';
  for (const [cat, govs] of Object.entries(governmentCategories)) {
    if (govs.includes(city)) { category = cat; break; }
  }
  return category;
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
