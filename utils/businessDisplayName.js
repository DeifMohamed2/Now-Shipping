const User = require('../models/user');
const BusinessDeletionAudit = require('../models/businessDeletionAudit');

/**
 * Display name for a populated or lean business user document.
 */
function getBusinessDisplayName(business) {
  if (!business) return null;
  if (business.isDeleted) {
    const preserved =
      business.originalBrandName ||
      business.originalName ||
      business.brandInfo?.brandName ||
      business.name ||
      'Business';
    return `Removed — ${preserved}`;
  }
  return (
    business.brandInfo?.brandName ||
    business.name ||
    business.originalBrandName ||
    business.originalName ||
    null
  );
}

/**
 * Resolve display name by business id (user doc or deletion audit after cascade).
 */
async function resolveBusinessDisplayName(businessId) {
  if (!businessId) return null;
  const user = await User.findById(businessId)
    .select('name brandInfo isDeleted originalName originalBrandName')
    .lean();
  if (user) {
    return getBusinessDisplayName(user);
  }
  const audit = await BusinessDeletionAudit.findOne({ businessId })
    .sort({ deletedAt: -1 })
    .lean();
  if (audit) {
    const preserved =
      audit.originalBrandName || audit.originalName || 'Business';
    return `Removed — ${preserved}`;
  }
  return 'Removed — Unknown business';
}

/**
 * Attach businessDisplayName on order-like objects with populated business.
 */
function attachBusinessDisplayName(orderObj) {
  if (!orderObj) return orderObj;
  const name = getBusinessDisplayName(orderObj.business);
  if (name) {
    orderObj.businessDisplayName = name;
  }
  return orderObj;
}

module.exports = {
  getBusinessDisplayName,
  resolveBusinessDisplayName,
  attachBusinessDisplayName,
};
