/**
 * CORS for Shopify Admin UI extensions (hosted on extensions.shopifycdn.com).
 */
const ALLOWED_ORIGINS = [
  /^https:\/\/extensions\.shopifycdn\.com$/,
  /^https:\/\/admin\.shopify\.com$/,
];

function isAllowedOrigin(origin) {
  return origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
}

function shopifyExtensionCors(req, res, next) {
  const origin = req.get('Origin');
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
}

module.exports = { shopifyExtensionCors };
