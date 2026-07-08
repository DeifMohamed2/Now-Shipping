#!/usr/bin/env node
/**
 * End-to-end regression tests for WooCommerce integration (pairing → connect → auth → webhooks).
 * Simulates the WordPress plugin against real Node server modules.
 *
 * Run: node scripts/test-woocommerce-e2e.js
 * Requires: DATABASE_URL (or MONGODB_URI) and JWT_SECRET in environment / .env
 */
require('dotenv').config();

const crypto = require('crypto');
const mongoose = require('mongoose');

const User = require('../models/user');
const Order = require('../models/order');
const WoocommercePairingGrant = require('../models/woocommercePairingGrant');
const WoocommerceInstallation = require('../models/woocommerceInstallation');
const WoocommerceSyncLog = require('../models/woocommerceSyncLog');

const { postPairing } = require('../controllers/woocommerceBusinessController');
const { postConnect } = require('../controllers/woocommercePublicController');
const { handleWebhook } = require('../controllers/woocommerceWebhookController');
const { verifyWoocommerceInstallation } = require('../middleware/woocommerceInstallationAuth');
const { verifyWoocommerceAppHmac } = require('../middleware/woocommerceAppHmac');
const { syncWcOrderCreate } = require('../utils/woocommerceOrderSync');
const { normalizeStoreUrl } = require('../utils/woocommerceService');

let passed = 0;
let failed = 0;

const runId = Date.now();
const testEmail = `woo-e2e-${runId}@example.com`;
const testPhone = `0199${String(runId).slice(-7)}`;
const storeUrl = `https://woo-e2e-${runId}.example.com`;

/** @type {import('mongoose').Types.ObjectId | null} */
let businessId = null;
/** @type {string} */
let installationToken = '';
/** @type {string} */
let sharedSecret = '';
/** @type {string} */
let normalizedStoreUrl = '';
/** @type {number} */
let wcOrderId = 88000 + (runId % 10000);

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log('  PASS:', message);
  } else {
    failed += 1;
    console.error('  FAIL:', message);
  }
}

function makeJsonRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    redirect() {
      return this;
    },
  };
}

function buildEgyptWcOrder(overrides = {}) {
  const id = overrides.id != null ? overrides.id : wcOrderId;
  return {
    id,
    number: String(overrides.number != null ? overrides.number : id),
    status: overrides.status != null ? overrides.status : 'processing',
    currency: 'EGP',
    total: '500.00',
    payment_method: 'cod',
    payment_method_title: 'Cash on delivery',
    date_paid: null,
    date_created: new Date().toISOString(),
    date_modified: new Date().toISOString(),
    shipping: {
      first_name: 'Ahmed',
      last_name: 'E2E',
      company: '',
      address_1: '12 Tahrir Street',
      address_2: '',
      city: 'Cairo',
      state: 'Cairo',
      postcode: '',
      country: 'EG',
      phone: '01012345678',
      ...(overrides.shipping || {}),
    },
    billing: {
      first_name: 'Ahmed',
      last_name: 'E2E',
      phone: '01012345678',
    },
    line_items: [{ name: 'T-Shirt', quantity: 2, virtual: false }],
    shipping_lines: [{ method_title: 'Flat rate', method_id: 'flat_rate' }],
    ...overrides,
  };
}

function signPayload(secret, bodyObj) {
  const raw = JSON.stringify(bodyObj);
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  return { raw, ts, sig };
}

function makeWebhookReq(raw, headers) {
  const map = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v])
  );
  return {
    body: Buffer.from(raw, 'utf8'),
    get(name) {
      return map[String(name).toLowerCase()] || '';
    },
  };
}

async function callWebhook(topic, bodyObj, secret, headerOverrides = {}) {
  const { raw, ts, sig } = signPayload(secret, bodyObj);
  const req = makeWebhookReq(raw, {
    'X-Now-Topic': topic,
    'X-Now-Signature': headerOverrides.sig != null ? headerOverrides.sig : sig,
    'X-Now-Timestamp': headerOverrides.ts != null ? headerOverrides.ts : ts,
    ...headerOverrides,
  });
  const res = makeJsonRes();
  await handleWebhook(req, res);
  return res;
}

async function runMiddlewareChain(middlewares, req) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };

  let idx = 0;
  let settled = false;

  await new Promise((resolve, reject) => {
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    const origJson = res.json.bind(res);
    res.json = (data) => {
      origJson(data);
      finish();
      return res;
    };

    const next = async (err) => {
      if (err) return finish(err);
      const fn = middlewares[idx];
      idx += 1;
      if (!fn) return finish();
      try {
        await Promise.resolve(fn(req, res, next));
      } catch (e) {
        finish(e);
      }
    };

    next();
  });

  return res;
}

async function seedBusinessUser() {
  const user = await User.create({
    role: 'business',
    name: 'Woo E2E Test',
    email: testEmail,
    password: 'test-password-hash',
    phoneNumber: testPhone,
    pickUpAddresses: [
      {
        addressId: `addr_e2e_${runId}`,
        addressName: 'E2E Pickup',
        isDefault: true,
        pickUpPointInMaps: 'Cairo',
        government: 'Cairo',
        zone: 'Nasr City - Tag Sultan',
      },
    ],
  });
  businessId = user._id;
  return user;
}

async function cleanup() {
  if (!businessId) return;
  await Order.deleteMany({ business: businessId });
  await WoocommerceSyncLog.deleteMany({ business: businessId });
  await WoocommercePairingGrant.deleteMany({ business: businessId });
  await WoocommerceInstallation.deleteMany({ business: businessId });
  await User.deleteOne({ _id: businessId });
}

async function stepPairing() {
  console.log('\n=== Step 1: Pairing code generation ===\n');

  const req = { userData: { _id: businessId } };
  const res = makeJsonRes();
  await postPairing(req, res);

  assert(res.statusCode === 200, 'postPairing returns 200');
  assert(res.body && res.body.ok === true, 'postPairing ok:true');
  assert(/^nsw_[a-f0-9]{32}$/.test(res.body.publicCode), 'publicCode matches nsw_ pattern');
  assert(typeof res.body.secret === 'string' && res.body.secret.length >= 16, 'secret returned');
  assert(res.body.expiresAt, 'expiresAt returned');

  const grant = await WoocommercePairingGrant.findOne({ publicCode: res.body.publicCode }).lean();
  assert(!!grant, 'WoocommercePairingGrant persisted');
  assert(grant && !grant.consumedAt, 'grant not yet consumed');
  if (grant && grant.expiresAt) {
    const hours = (new Date(grant.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000);
    assert(hours > 23 && hours <= 24.1, 'grant expires in ~24h');
  }

  return { publicCode: res.body.publicCode, secret: res.body.secret };
}

async function stepConnect(pairing) {
  console.log('\n=== Step 2: Plugin connect (pairing exchange) ===\n');

  const connectReq = {
    body: {
      publicCode: pairing.publicCode,
      secret: pairing.secret,
      storeUrl,
      wcVersion: '8.9.0',
      phpVersion: '8.2.0',
    },
  };
  const connectRes = makeJsonRes();
  await postConnect(connectReq, connectRes);

  assert(connectRes.statusCode === 200, 'postConnect returns 200');
  assert(connectRes.body && connectRes.body.ok === true, 'postConnect ok:true');
  assert(connectRes.body.installationToken && connectRes.body.installationToken.length === 64, 'installationToken returned');
  assert(connectRes.body.sharedSecret && connectRes.body.sharedSecret.length === 64, 'sharedSecret returned');

  installationToken = connectRes.body.installationToken;
  sharedSecret = connectRes.body.sharedSecret;
  normalizedStoreUrl = normalizeStoreUrl(storeUrl);

  const inst = await WoocommerceInstallation.findOne({ storeUrl: normalizedStoreUrl }).lean();
  assert(!!inst, 'WoocommerceInstallation created');
  assert(inst && String(inst.business) === String(businessId), 'installation linked to business');
  assert(inst && inst.isActive === true, 'installation is active');

  const consumed = await WoocommercePairingGrant.findOne({ publicCode: pairing.publicCode }).lean();
  assert(consumed && consumed.consumedAt, 'pairing grant consumed');

  const reuseRes = makeJsonRes();
  await postConnect(connectReq, reuseRes);
  assert(reuseRes.statusCode === 401, 'reused pairing code rejected');

  const badSecretRes = makeJsonRes();
  await postConnect(
    {
      body: {
        publicCode: `nsw_${crypto.randomBytes(16).toString('hex')}`,
        secret: 'wrong-secret',
        storeUrl,
      },
    },
    badSecretRes
  );
  assert(badSecretRes.statusCode === 401, 'wrong secret rejected');
}

async function stepAuth() {
  console.log('\n=== Step 3: Bearer + HMAC auth ===\n');

  const body = { enabled: false };
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', sharedSecret).update(raw, 'utf8').digest('hex');

  const goodReq = {
    method: 'PUT',
    rawBody: raw,
    body,
    get(header) {
      const h = String(header).toLowerCase();
      if (h === 'authorization') return `Bearer ${installationToken}`;
      if (h === 'x-now-signature') return sig;
      if (h === 'x-now-timestamp') return ts;
      return '';
    },
  };

  const goodRes = await runMiddlewareChain(
    [verifyWoocommerceInstallation, verifyWoocommerceAppHmac],
    goodReq
  );
  assert(goodRes.statusCode === 200 || !!goodReq.wcInstallation, 'valid auth passes middleware');
  assert(!!goodReq.wcInstallation, 'wcInstallation attached to request');
  assert(!!goodReq.wcSharedSecret, 'wcSharedSecret attached to request');

  const badSigReq = {
    method: 'POST',
    rawBody: raw,
    body,
    get(header) {
      const h = String(header).toLowerCase();
      if (h === 'authorization') return `Bearer ${installationToken}`;
      if (h === 'x-now-signature') return `${sig.slice(0, -1)}0`;
      if (h === 'x-now-timestamp') return ts;
      return '';
    },
  };
  const badSigRes = await runMiddlewareChain(
    [verifyWoocommerceInstallation, verifyWoocommerceAppHmac],
    badSigReq
  );
  assert(badSigRes.statusCode === 401, 'tampered signature rejected');

  const staleTs = String(Date.now() - 10 * 60 * 1000);
  const staleReq = {
    method: 'POST',
    rawBody: raw,
    body,
    get(header) {
      const h = String(header).toLowerCase();
      if (h === 'authorization') return `Bearer ${installationToken}`;
      if (h === 'x-now-signature') return sig;
      if (h === 'x-now-timestamp') return staleTs;
      return '';
    },
  };
  const staleRes = await runMiddlewareChain(
    [verifyWoocommerceInstallation, verifyWoocommerceAppHmac],
    staleReq
  );
  assert(staleRes.statusCode === 401, 'stale timestamp rejected');
}

async function stepOrderCreateWebhook() {
  console.log('\n=== Step 4: Order create webhook ===\n');

  const order = buildEgyptWcOrder();
  const bodyObj = { storeUrl: normalizedStoreUrl, order };
  const res = await callWebhook('orders/create', bodyObj, sharedSecret);

  assert(res.statusCode === 200, 'orders/create webhook returns 200');
  assert(res.body && res.body.ok === true, 'orders/create ok:true');

  const nowOrder = await Order.findOne({
    business: businessId,
    externalSource: 'woocommerce',
    externalOrderId: String(wcOrderId),
  }).lean();
  assert(!!nowOrder, 'Now Order created from webhook');
  assert(nowOrder && nowOrder.orderStatus, 'order has status');

  const log = await WoocommerceSyncLog.findOne({
    business: businessId,
    wcOrderId: String(wcOrderId),
    topic: 'orders/create',
    status: 'success',
  }).lean();
  assert(!!log, 'success WoocommerceSyncLog written');
  assert(log && log.nowOrderNumber, 'sync log has nowOrderNumber');
}

async function stepEdgeCases() {
  console.log('\n=== Step 5: Skipped edge cases (duplicate / non-Egypt) ===\n');

  const dupOrder = buildEgyptWcOrder();
  const dupRes = await callWebhook(
    'orders/create',
    { storeUrl: normalizedStoreUrl, order: dupOrder },
    sharedSecret
  );
  assert(dupRes.statusCode === 200, 'duplicate webhook HTTP 200');

  const dupLog = await WoocommerceSyncLog.findOne({
    business: businessId,
    wcOrderId: String(wcOrderId),
    topic: 'orders/create',
    status: 'skipped',
    reason: 'duplicate',
  }).lean();
  assert(!!dupLog, 'duplicate order logged as skipped');

  const nonEgId = wcOrderId + 1;
  const nonEgOrder = buildEgyptWcOrder({
    id: nonEgId,
    shipping: {
      first_name: 'John',
      last_name: 'US',
      address_1: '123 Main St',
      city: 'New York',
      state: 'NY',
      country: 'US',
      phone: '01099998888',
    },
  });
  const result = await syncWcOrderCreate(normalizedStoreUrl, nonEgOrder);
  assert(result && result.skipped === true, 'non-Egypt order skipped');
  assert(result && result.reason === 'non_egypt_shipping', 'non-Egypt reason correct');

  const noAddrId = wcOrderId + 2;
  const noAddrOrder = buildEgyptWcOrder({
    id: noAddrId,
    shipping: {
      first_name: 'No',
      last_name: 'Address',
      address_1: '',
      city: '',
      state: '',
      country: 'EG',
      phone: '01011112222',
    },
    shipping_lines: [],
  });
  const noAddrResult = await syncWcOrderCreate(normalizedStoreUrl, noAddrOrder);
  assert(noAddrResult && noAddrResult.skipped === true, 'missing address skipped');
}

async function stepCancel() {
  console.log('\n=== Step 6: Cancel webhook ===\n');

  const cancelOrder = buildEgyptWcOrder({ status: 'cancelled' });
  const cancelRes = await callWebhook(
    'orders/updated',
    { storeUrl: normalizedStoreUrl, order: cancelOrder },
    sharedSecret
  );
  assert(cancelRes.statusCode === 200, 'orders/updated cancel returns 200');

  const canceled = await Order.findOne({
    business: businessId,
    externalSource: 'woocommerce',
    externalOrderId: String(wcOrderId),
  }).lean();
  assert(canceled && canceled.orderStatus === 'canceled', 'Now order canceled when WC cancelled');

  const lockedId = wcOrderId + 10;
  const lockedWcOrder = buildEgyptWcOrder({ id: lockedId });
  await syncWcOrderCreate(normalizedStoreUrl, lockedWcOrder);

  await Order.updateOne(
    { business: businessId, externalOrderId: String(lockedId) },
    { $set: { orderStatus: 'inTransit' } }
  );

  const lockedCancel = buildEgyptWcOrder({ id: lockedId, status: 'cancelled' });
  const lockedResult = await syncWcOrderUpdatedDirect(lockedCancel);
  assert(lockedResult && lockedResult.skipped === true, 'inTransit order not canceled');
  assert(lockedResult && lockedResult.reason === 'status_locked', 'status_locked reason');
}

async function syncWcOrderUpdatedDirect(wcOrder) {
  const { syncWcOrderUpdated } = require('../utils/woocommerceOrderSync');
  return syncWcOrderUpdated(normalizedStoreUrl, wcOrder);
}

async function stepUninstall() {
  console.log('\n=== Step 7: Plugin uninstall webhook ===\n');

  const res = await callWebhook('app/uninstalled', { storeUrl: normalizedStoreUrl }, sharedSecret);
  assert(res.statusCode === 200, 'app/uninstalled returns 200');

  const inst = await WoocommerceInstallation.findOne({ storeUrl: normalizedStoreUrl }).lean();
  assert(inst && inst.uninstalledAt, 'installation marked uninstalled');
  assert(inst && inst.isActive === false, 'installation inactive after uninstall');

  const afterRes = makeJsonRes();
  const req = {
    get(header) {
      if (String(header).toLowerCase() === 'authorization') return `Bearer ${installationToken}`;
      return '';
    },
  };
  await verifyWoocommerceInstallation(req, afterRes);
  assert(afterRes.statusCode === 401, 'revoked installation token rejected');
}

async function main() {
  const db = process.env.DATABASE_URL || process.env.MONGODB_URI;
  if (!db) {
    console.error('DATABASE_URL or MONGODB_URI is required');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'nodedemo';
    console.warn('JWT_SECRET not set — using dev fallback "nodedemo"');
  }

  console.log('WooCommerce E2E tests');
  console.log('Store URL:', storeUrl);
  console.log('Business email:', testEmail);

  try {
    await mongoose.connect(db);
    await seedBusinessUser();

    const pairing = await stepPairing();
    await stepConnect(pairing);
    await stepAuth();
    await stepOrderCreateWebhook();
    await stepEdgeCases();
    await stepCancel();
    await stepUninstall();
  } catch (err) {
    failed += 1;
    console.error('\nUnexpected error:', err.message || err);
    if (err.stack) console.error(err.stack);
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
