const mongoose = require('mongoose');
const User = require('../models/user');

/**
 * Read merchant identifier from X-Merchant-Id header or merchantId query param.
 */
function extractMerchantId(req) {
  const header = req.headers['x-merchant-id'];
  if (header && String(header).trim()) {
    return String(header).trim();
  }
  if (req.query && req.query.merchantId && String(req.query.merchantId).trim()) {
    return String(req.query.merchantId).trim();
  }
  return null;
}

/**
 * Find a merchant sub-account owned by the given company.
 */
async function findMerchantForCompany(companyId, merchantIdValue) {
  if (!merchantIdValue) return null;

  const companyOid = companyId;
  const orClauses = [
    { businessAccountCode: merchantIdValue },
    { externalMerchantId: merchantIdValue },
  ];
  if (mongoose.Types.ObjectId.isValid(merchantIdValue)) {
    orClauses.push({ _id: merchantIdValue });
  }

  return User.findOne({
    $or: orClauses,
    parentCompany: companyOid,
    role: { $in: ['business', 'Business'] },
    isDeleted: { $ne: true },
  });
}

/**
 * Serialize merchant for public API list/detail responses.
 */
function serializeMerchantSummary(user) {
  const u = user.toObject ? user.toObject() : user;
  return {
    id: u._id,
    businessAccountCode: u.businessAccountCode || null,
    name: u.name,
    brandName: u.brandInfo?.brandName || null,
    email: u.email,
    phoneNumber: u.phoneNumber,
    isCompleted: u.isCompleted,
    isVerified: u.isVerified,
    parentCompany: u.parentCompany || null,
    externalMerchantId: u.externalMerchantId || null,
    createdAt: u.createdAt,
  };
}

module.exports = {
  extractMerchantId,
  findMerchantForCompany,
  serializeMerchantSummary,
};
