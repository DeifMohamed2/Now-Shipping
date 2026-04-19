/**
 * Unique 8-digit numeric code for business accounts (admin search, support, payouts).
 */

function isBusinessRole(role) {
  const r = (role || '').toString();
  return r === 'business' || r === 'Business';
}

/**
 * Generate a new code and verify uniqueness against User collection.
 */
async function generateUniqueBusinessAccountCode() {
  const User = require('../models/user');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = String(Math.floor(10000000 + Math.random() * 90000000));
    const exists = await User.exists({ businessAccountCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not allocate a unique 8-digit business account code');
}

/**
 * Persist a code on a business user if missing (used after search / lazy backfill).
 */
async function ensureBusinessAccountCode(userId) {
  const User = require('../models/user');
  const user = await User.findById(userId).select('role businessAccountCode').lean();
  if (!user || !isBusinessRole(user.role) || user.businessAccountCode) return user?.businessAccountCode || null;
  const code = await generateUniqueBusinessAccountCode();
  await User.updateOne({ _id: userId }, { $set: { businessAccountCode: code } });
  return code;
}

module.exports = {
  isBusinessRole,
  generateUniqueBusinessAccountCode,
  ensureBusinessAccountCode,
};
