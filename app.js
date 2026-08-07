require('dotenv').config();

// Web Crypto: some libs assume `globalThis.crypto`; Node 18+ usually provides it — polyfill for older/edge runtimes.
const nodeCrypto = require('node:crypto');
if (typeof globalThis.crypto === 'undefined' && nodeCrypto.webcrypto) {
  globalThis.crypto = nodeCrypto.webcrypto;
}

// @shopify/shopify-api Node adapter — load before any route/module calls shopifyApi() / validateHmac.
require('@shopify/shopify-api/adapters/node');

const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const { renderNotFound } = require('./utils/renderNotFound');
const http = require('http');
const server = http.createServer(app);
const socketController = require('./controllers/socketController');
const siteConfig = require('./config/site');
const { assetVersion } = require('./config/assetVersion');

// Initialize Firebase Admin SDK
require('./config/firebase');

// Initialize Socket.IO and store it on the app
const io = socketController.initializeSocket(server);
app.set('io', io);

// Web Routes
const adminRouter = require('./routes/web/adminRoutes');
const courierRouter = require('./routes/web/courierRoutes');
const businessRouter = require('./routes/web/businessRoutes');
const manageRouter = require('./routes/web/manageRoutes');
const authRouter = require('./routes/web/authRoutes');

// Mobile Routes
const AuthRouterApi = require('./routes/api/v1/auth');
const businessRouterApi = require('./routes/api/v1/business');
const assistantRouterApi = require('./routes/api/v1/assistant');
const courierRouterApi = require('./routes/api/v1/courier');
const ticketRouterApi = require('./routes/api/v1/ticketRoutes');
const uploadRouterApi = require('./routes/api/v1/upload');
const publicApiV1Router = require('./routes/api/public/v1');

// Import jobs
const { initPayoutProcessing } = require('./jobs/payoutProcessing');
const { initShopifySyncRetry } = require('./jobs/shopifySyncRetry');
const { initWoocommerceSyncRetry } = require('./jobs/woocommerceSyncRetry');

// Start the Wednesday payout cron
initPayoutProcessing();
initShopifySyncRetry();
initWoocommerceSyncRetry();

const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const upload = require('express-fileupload');

const flash = require('connect-flash');
var i18n = require('i18n-express');
var bodyParser = require('body-parser');
const {
  languageMiddleware,
  handleLanguageSwitch,
} = require('./middleware/languageMiddleware');
var urlencodeParser = bodyParser.urlencoded({
  extended: true,
});
app.use(urlencodeParser);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.assetVersion = assetVersion;

// express-fileupload and multer both parse multipart bodies; running both on the same
// request consumes the stream and breaks the second parser ("Unexpected end of form", 400).
function shouldSkipExpressFileUpload(req) {
  const p = req.path || '';
  if (p === '/business/orders-import-validate' || p === '/business/orders-import-commit') {
    return true;
  }
  // Multer handles these; express-fileupload must not parse the same multipart body.
  if (p === '/business/ainow/voice' || p === '/api/v1/assistant/ainow/voice') {
    return true;
  }
  if (req.method === 'POST' && /^\/api\/v1\/tickets\/[^/]+\/upload$/.test(p)) {
    return true;
  }
  if (p.startsWith('/api/shopify/webhooks')) {
    return true;
  }
  if (p.startsWith('/api/woocommerce/webhooks')) {
    return true;
  }
  return false;
}
app.use((req, res, next) => {
  if (shouldSkipExpressFileUpload(req)) {
    return next();
  }
  return upload()(req, res, next);
});

const shopifyWebhooksRouter = require('./routes/shopifyWebhooks');
const shopifyAppRouter = require('./routes/shopifyAppRoutes');
const shopifyController = require('./controllers/shopifyController');
const woocommerceWebhooksRouter = require('./routes/woocommerceWebhooks');
const woocommerceAppRouter = require('./routes/woocommerceAppRoutes');
const woocommercePublicRouter = require('./routes/woocommercePublicRoutes');
const woocommercePluginController = require('./controllers/woocommercePluginController');

// Shopify Admin webhooks: must use raw body for HMAC verification (before express.json).
app.use(
  '/api/shopify/webhooks',
  express.raw({ type: 'application/json' }),
  shopifyWebhooksRouter
);

// WooCommerce plugin → Now webhooks (HMAC, raw body).
app.use(
  '/api/woocommerce/webhooks',
  express.raw({ type: 'application/json' }),
  woocommerceWebhooksRouter
);

// WooCommerce app API: raw body string for HMAC on POST/PUT.
const woocommerceAppJson = express.json({
  limit: '2mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
});
app.use('/api/woocommerce/app', woocommerceAppJson, woocommerceAppRouter);

app.use(express.json());
const { shopifyExtensionCors } = require('./middleware/shopifyExtensionCors');
app.use('/api/shopify/app', shopifyExtensionCors, shopifyAppRouter);

app.get('/api/woocommerce/plugin/latest', woocommercePluginController.getPluginLatest);
app.get('/api/woocommerce/plugin/download', woocommercePluginController.getPluginDownload);
app.use('/api/woocommerce', woocommercePublicRouter);
app.use(
  session({
    resave: false,
    saveUninitialized: true,
    secret: process.env.SESSION_SECRET || 'nodedemo',
  })
);
app.use(cookieParser());

app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) {
    app.set('layout', 'layouts/admin-layout');
  } else if (req.path.startsWith('/courier')) {
    app.set('layout', 'layouts/courier-layout');
  } else if (req.path.startsWith('/business')) {
    app.set('layout', 'layouts/layout');
  } else {
    // No layout is set for paths that don't match the specified prefixes
  }
  next();
});
app.use(expressLayouts);
app.use(flash());

app.use(express.static(__dirname + '/public'));

// Language middleware
app.use(languageMiddleware);
app.use(handleLanguageSwitch);

/* ---------for Local database connection---------- */
const DB = process.env.DATABASE_URL;

// Connect to database first, then start server
mongoose
  .connect(DB)
  .then((con) => {
    console.log('DB connection successfully..!');
    console.log(`Asset version: ${assetVersion}`);

    // Start server after successful database connection
    server.listen(process.env.PORT, () =>
      console.log(`Server running on port http://localhost:${process.env.PORT}`)
    );
  })
  .catch((err) => {
    console.error('Database connection failed:', err);
    process.exit(1);
  });

// for i18 use
app.use(
  i18n({
    translationsPath: path.join(__dirname, 'i18n'),
    siteLangs: ['ar', 'en'],
    defaultLang: 'en',
    cookieLangName: 'language',
    paramLangName: 'lang',
    textsVarName: 'translation',
  })
);

// Sidebar/topbar logo: `/index` is not a route (404). Use each area’s dashboard (or `/` for public pages).
// Site contact email for footers, mailto links, and shared templates (`config/site.js`).
app.use((req, res, next) => {
  res.locals.siteContactEmail = siteConfig.contactEmail;
  res.locals.sitePublicPhone = siteConfig.publicPhone;
  res.locals.sitePhysicalAddress = siteConfig.physicalAddress;
  res.locals.siteLegalEntityName = siteConfig.legalEntityName;
  const p = req.path || '';
  if (p.startsWith('/admin')) res.locals.logoHomeHref = '/admin/dashboard';
  else if (p.startsWith('/business')) res.locals.logoHomeHref = '/business/dashboard';
  else if (p.startsWith('/manage')) res.locals.logoHomeHref = '/manage/dashboard';
  else if (p.startsWith('/courier')) res.locals.logoHomeHref = '/mobileApp';
  else res.locals.logoHomeHref = '/';
  next();
});

app.use((err, req, res, next) => {
  let error = {
    err,
  };
  if (error.name === 'JsonWebTokenError') {
    err.message = 'please login again';
    err.statusCode = 401;
    return res.status(401).redirect('views/auth/login');
  }
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'errors';

  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
  });
});

// Define All Route
app.use('/', authRouter);
app.use('/admin', adminRouter);
app.use('/business', businessRouter);
app.use('/manage', manageRouter);
app.use('/courier', courierRouter);

// Emergency FCM token cleanup route (public, no auth required)
const notificationController = require('./controllers/notificationController');
app.get(
  '/emergency-cleanup/:courierId',
  notificationController.emergencyCleanupCourier
);

// Mobile app routes V1 — tell CDNs (e.g. Cloudflare) not to transform response bodies.
// Clients that send Accept-Encoding: br may otherwise receive Brotli-compressed JSON; many mobile
// stacks decode gzip but not br, which surfaces as FormatException when parsing JSON (bad UTF-8 at offset 0).
app.use('/api/v1', (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-transform');
  next();
});
app.use('/api/v1/auth', AuthRouterApi);
app.use('/api/v1/business', businessRouterApi);
app.use('/api/v1/assistant', assistantRouterApi);
app.use('/api/v1/courier', courierRouterApi);
app.use('/api/v1/tickets', ticketRouterApi);
app.use('/api/v1/upload', uploadRouterApi);

// Public integration API (business API keys)
app.use('/api/public/v1', (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-transform');
  next();
});
app.use('/api/public/v1', publicApiV1Router);

app.get('/api/shopify/auth/callback', shopifyController.oauthCallback);

// Admin link extension used url="/deliver" (origin-absolute) → now.com.eg/deliver. Redirect to SPA route.
app.get(/^\/deliver\/?$/, (req, res) => {
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, `/shopify-app/deliver${q}`);
});

// Embedded Shopify Admin UI (Vite build → public/shopify-app)
// If Partner "App URL" was set to /shopify by mistake, redirect to the real SPA (preserve query e.g. host=).
app.get(/^\/shopify\/?$/, (req, res) => {
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, `/shopify-app/${q}`);
});

// Express 5 / path-to-regexp: do not use app.get('/shopify-app/*') — bare * is invalid.
const shopifySpaDir = path.join(__dirname, 'public', 'shopify-app');
const shopifySpaIndex = path.join(shopifySpaDir, 'index.html');

function sendShopifySpa(req, res, next) {
  if (!fs.existsSync(shopifySpaIndex)) {
    console.error(
      '[shopify-app] Missing SPA build at public/shopify-app/index.html — run: npm run build:shopify-ui'
    );
    return next();
  }
  res.sendFile(shopifySpaIndex, (err) => {
    if (err) {
      console.error('[shopify-app] Failed to serve SPA index:', err.message);
      next(err);
    }
  });
}

// Static assets (JS/CSS/images). index:false so /shopify-app/ is handled by explicit routes below.
app.use('/shopify-app', express.static(shopifySpaDir, { fallthrough: true, index: false }));

// SPA shell: root and client routes (e.g. /deliver, /pickups, /settings)
app.get(/^\/shopify-app\/?$/, sendShopifySpa);
app.get(/^\/shopify-app\/.+/, (req, res, next) => {
  if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next();
  sendShopifySpa(req, res, next);
});

// Catch-all 404 — branded page with layout per area (business, admin, courier, public).
app.use(function (req, res) {
  renderNotFound(req, res);
});

// Server is now started inside the mongoose.connect().then() callback
