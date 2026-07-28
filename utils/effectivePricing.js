const User = require('../models/user');
const { resolveBusinessPricing } = require('./fees');

/**
 * Resolve pricing for fee calculation.
 * Sub-accounts (merchants with parentCompany) always inherit the parent's custom pricing.
 * Standalone businesses use their own customPricing when enabled.
 *
 * @param {object} businessDoc - Business user document or plain object
 * @returns {Promise<object|null>} Pricing context or null for global defaults
 */
async function resolveEffectivePricing(businessDoc) {
  if (!businessDoc) return null;

  const parentId =
    businessDoc.parentCompany?._id ||
    businessDoc.parentCompany ||
    null;

  if (parentId) {
    const parent =
      businessDoc.parentCompany && businessDoc.parentCompany.customPricing
        ? businessDoc.parentCompany
        : await User.findById(parentId).select('customPricing').lean();

    if (parent) {
      return resolveBusinessPricing(parent);
    }
    return null;
  }

  return resolveBusinessPricing(businessDoc);
}

module.exports = {
  resolveEffectivePricing,
};
