const { verifyHmacHex, verifyTimestampHeader } = require('../utils/woocommerceAuth');

/**
 * Verifies X-Now-Signature (hex HMAC-SHA256 of raw JSON body) for mutating requests.
 * Requires `express.json({ verify })` to set `req.rawBody`.
 */
function verifyWoocommerceAppHmac(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }
  const ts = req.get('X-Now-Timestamp');
  if (!verifyTimestampHeader(ts)) {
    return res.status(401).json({ error: 'invalid_timestamp' });
  }
  const sig = req.get('X-Now-Signature') || '';
  const raw = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body ?? {});
  const secret = req.wcSharedSecret;
  if (!verifyHmacHex(secret, raw, sig)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  return next();
}

module.exports = { verifyWoocommerceAppHmac };
