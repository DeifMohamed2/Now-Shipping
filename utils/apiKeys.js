const crypto = require('crypto');

const KEY_PREFIX = 'nsk_live_';
const KEY_RANDOM_BYTES = 24;

/**
 * Generate a new API key. Returns { rawKey, keyPrefix, keyHash, lastFour }.
 * The raw key is shown once to the admin; only keyHash is stored.
 */
function generateApiKey() {
  const randomPart = crypto.randomBytes(KEY_RANDOM_BYTES).toString('hex');
  const rawKey = `${KEY_PREFIX}${randomPart}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);
  const lastFour = rawKey.slice(-4);
  return { rawKey, keyPrefix, keyHash, lastFour };
}

/**
 * SHA-256 hash of the full API key for storage and lookup.
 */
function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey).trim()).digest('hex');
}

/**
 * Extract API key from Authorization: Bearer or X-Api-Key header.
 */
function extractApiKeyFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && /^Bearer\s+/i.test(String(authHeader))) {
    const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
    if (token && token.startsWith('nsk_')) return token;
  }
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && String(xApiKey).trim().startsWith('nsk_')) {
    return String(xApiKey).trim();
  }
  return null;
}

module.exports = {
  KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  extractApiKeyFromRequest,
};
