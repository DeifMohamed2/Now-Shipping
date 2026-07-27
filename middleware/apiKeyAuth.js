const mongoose = require('mongoose');
const User = require('../models/user');
const ApiKey = require('../models/apiKey');
const { hashApiKey, extractApiKeyFromRequest } = require('../utils/apiKeys');
const { extractMerchantId, findMerchantForCompany } = require('../utils/merchantResolve');

/** In-memory per-key rate limit: { tokens, lastRefill } */
const rateLimitBuckets = new Map();
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function sendApiError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    success: false,
    error: { code, message },
  });
}

function checkRateLimit(keyHash) {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(keyHash);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_MAX, lastRefill: now };
    rateLimitBuckets.set(keyHash, bucket);
  }
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    bucket.tokens = RATE_LIMIT_MAX;
    bucket.lastRefill = now;
  }
  if (bucket.tokens <= 0) {
    return false;
  }
  bucket.tokens -= 1;
  return true;
}

function touchApiKeyUsage(apiKeyDoc) {
  ApiKey.updateOne(
    { _id: apiKeyDoc._id },
    { $set: { lastUsedAt: new Date() }, $inc: { requestCount: 1 } }
  ).catch((err) => console.warn('[apiKeyAuth] failed to update usage:', err.message));
}

function isCompanyAccount(user) {
  return Boolean(user && user.isCompanyAccount);
}

function getApiKeyScopes(req) {
  const scopes = req.apiKey?.scopes;
  if (Array.isArray(scopes) && scopes.length) return scopes;
  return ['orders', 'pickups'];
}

function hasApiScope(req, scope) {
  return getApiKeyScopes(req).includes(scope);
}

/**
 * Require a specific API key scope. Merchant routes accept orders+pickups as backward compat.
 */
function requireApiScope(requiredScope, options = {}) {
  const { merchantBackwardCompat = false } = options;
  return (req, res, next) => {
    if (hasApiScope(req, requiredScope)) {
      return next();
    }
    if (
      merchantBackwardCompat &&
      requiredScope === 'merchants' &&
      hasApiScope(req, 'orders') &&
      hasApiScope(req, 'pickups')
    ) {
      return next();
    }
    return sendApiError(
      res,
      403,
      'SCOPE_DENIED',
      `This API key does not have the "${requiredScope}" scope required for this endpoint.`
    );
  };
}

/**
 * Authenticate public API requests via Bearer API key or X-Api-Key header.
 * Sets req.company (key owner), optionally req.merchant + req.userData.
 */
async function apiKeyAuth(req, res, next) {
  try {
    const rawKey = extractApiKeyFromRequest(req);
    if (!rawKey) {
      return sendApiError(
        res,
        401,
        'UNAUTHORIZED',
        'Missing or invalid API key. Use Authorization: Bearer nsk_live_... or X-Api-Key header.'
      );
    }

    const keyHash = hashApiKey(rawKey);
    if (!checkRateLimit(keyHash)) {
      return sendApiError(res, 429, 'RATE_LIMITED', 'Too many requests. Please slow down and retry later.');
    }

    const apiKeyDoc = await ApiKey.findOne({ keyHash, isActive: true }).populate('business');
    if (!apiKeyDoc) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Invalid or revoked API key.');
    }

    const account =
      apiKeyDoc.business && apiKeyDoc.business._id
        ? apiKeyDoc.business
        : await User.findById(apiKeyDoc.business);

    if (!account) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Business account not found for this API key.');
    }

    if (account.isDeleted) {
      return sendApiError(res, 403, 'ACCOUNT_REMOVED', 'This business account has been removed.');
    }

    const role = (account.role || '').toString().toLowerCase();
    if (role !== 'business') {
      return sendApiError(res, 403, 'FORBIDDEN', 'API key is not associated with a business account.');
    }

    req.apiKey = apiKeyDoc;
    req.company = account;
    req.business = account;
    req.isCompanyAccount = isCompanyAccount(account);

    const merchantIdValue = extractMerchantId(req);

    if (merchantIdValue) {
      if (!req.isCompanyAccount) {
        return sendApiError(
          res,
          400,
          'MERCHANT_NOT_APPLICABLE',
          'X-Merchant-Id is only used with company API keys. This key belongs to a single business account.'
        );
      }

      const merchant = await findMerchantForCompany(account._id, merchantIdValue);
      if (!merchant) {
        return sendApiError(
          res,
          403,
          'MERCHANT_NOT_FOUND',
          'Merchant not found or not linked to this company. Use GET /merchants to list valid merchant IDs.'
        );
      }

      req.merchant = merchant;
      req.userData = merchant;
      req.userId = merchant._id;
    } else if (!req.isCompanyAccount) {
      req.merchant = null;
      req.userData = account;
      req.userId = account._id;
    } else {
      req.merchant = null;
      req.userData = null;
      req.userId = null;
    }

    touchApiKeyUsage(apiKeyDoc);
    return next();
  } catch (error) {
    console.error('[apiKeyAuth] error:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Authentication failed.');
  }
}

/**
 * Require a resolved merchant for company API keys (order/pickup operations).
 * Plain business keys already have req.userData set in apiKeyAuth.
 */
function requireMerchant(req, res, next) {
  if (req.isCompanyAccount && !req.merchant) {
    return sendApiError(
      res,
      400,
      'MERCHANT_REQUIRED',
      'Company API keys require X-Merchant-Id header (businessAccountCode, externalMerchantId, or merchant Mongo _id). Use GET /merchants to list merchants.'
    );
  }
  if (!req.userData) {
    return sendApiError(res, 400, 'MERCHANT_REQUIRED', 'A merchant context is required for this operation.');
  }
  return next();
}

/**
 * Require company account (for /merchants endpoints).
 */
function requireCompanyAccount(req, res, next) {
  if (!req.isCompanyAccount) {
    return sendApiError(
      res,
      403,
      'FORBIDDEN',
      'This endpoint is only available for company API keys.'
    );
  }
  return next();
}

/**
 * Resolve merchant for optional operations (e.g. fee preview with merchant custom pricing).
 * If X-Merchant-Id is sent on a company key, merchant is already set by apiKeyAuth.
 * If company key without merchant, falls back to company account for pricing.
 */
function resolveMerchantForPricing(req, res, next) {
  if (req.isCompanyAccount && !req.merchant) {
    req.userData = req.company;
    req.userId = req.company._id;
  }
  return next();
}

module.exports = {
  apiKeyAuth,
  sendApiError,
  requireMerchant,
  requireCompanyAccount,
  resolveMerchantForPricing,
  requireApiScope,
};
