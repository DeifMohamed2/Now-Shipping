const User = require('../models/user');
const ApiKey = require('../models/apiKey');
const { generateApiKey } = require('../utils/apiKeys');

function isValidObjectId(id) {
  return id && /^[a-fA-F0-9]{24}$/.test(String(id));
}

/**
 * List API tokens for a business (admin).
 */
const listApiTokens = async (req, res) => {
  try {
    const { businessId } = req.params;
    if (!isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: 'Invalid business ID' });
    }

    const business = await User.findById(businessId).select('name brandInfo businessAccountCode');
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    const tokens = await ApiKey.find({ business: businessId })
      .sort({ createdAt: -1 })
      .select('-keyHash')
      .lean();

    return res.json({
      success: true,
      business: {
        id: business._id,
        name: business.name,
        brandName: business.brandInfo?.brandName || null,
        businessAccountCode: business.businessAccountCode || null,
      },
      tokens: tokens.map((t) => ({
        id: t._id,
        name: t.name,
        keyPrefix: t.keyPrefix,
        lastFour: t.lastFour,
        scopes: t.scopes,
        isActive: t.isActive,
        revokedAt: t.revokedAt,
        lastUsedAt: t.lastUsedAt,
        requestCount: t.requestCount,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    console.error('[apiTokenController] listApiTokens:', error);
    return res.status(500).json({ success: false, message: 'Failed to list API tokens' });
  }
};

/**
 * Create a new API token for a business. Returns the raw key once.
 */
const createApiToken = async (req, res) => {
  try {
    const { businessId } = req.params;
    const name = (req.body?.name || req.body?.label || '').trim();

    if (!isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: 'Invalid business ID' });
    }
    if (!name) {
      return res.status(400).json({ success: false, message: 'Token name is required' });
    }
    if (name.length > 120) {
      return res.status(400).json({ success: false, message: 'Token name must be 120 characters or less' });
    }

    const business = await User.findById(businessId);
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }
    if (business.isDeleted) {
      return res.status(400).json({ success: false, message: 'Cannot create tokens for a deleted business' });
    }

    const { rawKey, keyPrefix, keyHash, lastFour } = generateApiKey();

    const tokenDoc = await ApiKey.create({
      business: businessId,
      name,
      keyPrefix,
      keyHash,
      lastFour,
      scopes: ['orders', 'pickups', 'merchants'],
      isActive: true,
      createdByAdmin: req.adminId || req.adminData?._id || null,
    });

    return res.status(201).json({
      success: true,
      message: 'API token created. Copy the key now — it will not be shown again.',
      token: {
        id: tokenDoc._id,
        name: tokenDoc.name,
        keyPrefix: tokenDoc.keyPrefix,
        lastFour: tokenDoc.lastFour,
        scopes: tokenDoc.scopes,
        createdAt: tokenDoc.createdAt,
      },
      apiKey: rawKey,
    });
  } catch (error) {
    console.error('[apiTokenController] createApiToken:', error);
    return res.status(500).json({ success: false, message: 'Failed to create API token' });
  }
};

/**
 * Revoke an API token.
 */
const revokeApiToken = async (req, res) => {
  try {
    const { businessId, tokenId } = req.params;

    if (!isValidObjectId(businessId) || !isValidObjectId(tokenId)) {
      return res.status(400).json({ success: false, message: 'Invalid business or token ID' });
    }

    const token = await ApiKey.findOne({ _id: tokenId, business: businessId });
    if (!token) {
      return res.status(404).json({ success: false, message: 'API token not found' });
    }

    if (!token.isActive) {
      return res.json({ success: true, message: 'Token is already revoked.' });
    }

    token.isActive = false;
    token.revokedAt = new Date();
    await token.save();

    return res.json({ success: true, message: 'API token revoked successfully.' });
  } catch (error) {
    console.error('[apiTokenController] revokeApiToken:', error);
    return res.status(500).json({ success: false, message: 'Failed to revoke API token' });
  }
};

module.exports = {
  listApiTokens,
  createApiToken,
  revokeApiToken,
};
