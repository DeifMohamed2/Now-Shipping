#!/usr/bin/env node
/**
 * End-to-end smoke test for the Now Shipping Public API v1.
 *
 * What it does:
 *   1. Connects to MongoDB and seeds (or reuses) a test COMPANY account,
 *      a MERCHANT sub-account, and an API key with all scopes.
 *   2. Calls every public API endpoint against the running server.
 *   3. Prints a color-coded pass/fail report + summary to the terminal.
 *
 * Usage:
 *   1. Start the server:   npm run dev      (default port 6098)
 *   2. In another shell:   node scripts/test-public-api.js
 *
 * Options (env vars):
 *   BASE_URL     Override full base (default: http://localhost:$PORT/api/public/v1)
 *   PORT         Server port (default: from .env or 6098)
 *   KEEP_DATA    If "1", do not delete seeded test data at the end.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

const User = require('../models/user');
const ApiKey = require('../models/apiKey');
const { generateApiKey } = require('../utils/apiKeys');
const { getEarliestPickupDateIso } = require('../utils/pickupDatePolicy');

// ---------- config ----------
const PORT = process.env.PORT || 6098;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}/api/public/v1`;
const KEEP_DATA = process.env.KEEP_DATA === '1';

const TAG = `apitest_${Date.now()}`;
const COMPANY_EMAIL = `company_${TAG}@apitest.local`;
const MERCHANT_EMAIL = `merchant_${TAG}@apitest.local`;
const EXTERNAL_MERCHANT_ID = `shop_${TAG}`;
const TEST_GOVERNMENT = 'Cairo';
const TEST_ZONE = 'Nasr City - ElHay 06 (Nasr City)';

// ---------- terminal colors ----------
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m',
};

const results = [];
let seeded = {};

function line(char = '─', n = 62) {
  return char.repeat(n);
}

function header(title) {
  console.log('');
  console.log(c.cyan + c.bold + line('═') + c.reset);
  console.log(c.cyan + c.bold + '  ' + title + c.reset);
  console.log(c.cyan + c.bold + line('═') + c.reset);
}

function section(title) {
  console.log('');
  console.log(c.bold + c.yellow + '▶ ' + title + c.reset);
  console.log(c.gray + line('─') + c.reset);
}

/**
 * Run one HTTP check.
 * @param {string} name        Human label
 * @param {object} opts        { method, path, headers, body, expect, expectPdf }
 */
async function check(name, opts) {
  const { method = 'GET', path = '', headers = {}, body, expect = [200], expectPdf = false } = opts;
  const url = `${BASE_URL}${path}`;
  const startedAt = Date.now();

  const finalHeaders = { ...headers };
  let fetchBody;
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  let status = 0;
  let payload = null;
  let ok = false;
  let note = '';

  try {
    const res = await fetch(url, { method, headers: finalHeaders, body: fetchBody });
    status = res.status;
    const contentType = res.headers.get('content-type') || '';

    if (expectPdf) {
      const buf = Buffer.from(await res.arrayBuffer());
      const isPdf = contentType.includes('pdf') || buf.slice(0, 4).toString() === '%PDF';
      ok = expect.includes(status) && isPdf;
      note = isPdf ? `PDF ${buf.length} bytes` : `not a PDF (${contentType})`;
      payload = { pdf: isPdf, bytes: buf.length };
    } else {
      const text = await res.text();
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { raw: text.slice(0, 200) };
      }
      ok = expect.includes(status);
      if (!ok && payload && payload.error) {
        note = `${payload.error.code || ''} ${payload.error.message || ''}`.trim();
      }
    }
  } catch (err) {
    ok = false;
    note = `request failed: ${err.message} (is the server running on ${BASE_URL}?)`;
  }

  const ms = Date.now() - startedAt;
  results.push({ name, method, path, status, ok, ms });

  const badge = ok ? c.green + 'PASS' + c.reset : c.red + 'FAIL' + c.reset;
  const statusStr = status ? String(status) : '---';
  const methodStr = method.padEnd(6);
  console.log(
    `  ${badge}  ${c.gray}${methodStr}${c.reset} ${path || '/'}  ` +
      `${c.dim}[${statusStr}, ${ms}ms]${c.reset}` +
      (note ? `\n         ${c.gray}${note}${c.reset}` : '')
  );

  return { ok, status, payload };
}

/**
 * The test script MUST connect to the exact same database URI as the running
 * server (from .env), otherwise seeded API keys won't be visible to the API.
 */
async function resolveDbUri() {
  return process.env.DATABASE_URL || null;
}

async function seedTestData() {
  section('Seeding test data (DB)');

  const hashedPassword = await require('bcrypt').hash(crypto.randomBytes(16).toString('hex'), 10);

  // Company (integrator) account
  const company = new User({
    name: 'API Test Company',
    email: COMPANY_EMAIL,
    password: hashedPassword,
    phoneNumber: `019${Math.floor(10000000 + Math.random() * 89999999)}`.slice(0, 11),
    role: 'Business',
    isCompanyAccount: true,
    isVerified: true,
    isCompleted: true,
    brandInfo: { brandName: 'API Test Co' },
  });
  await company.save();
  console.log(`  ${c.green}✓${c.reset} Company account: ${company.businessAccountCode}`);

  // Merchant sub-account under the company
  const merchant = new User({
    name: 'API Test Merchant',
    email: MERCHANT_EMAIL,
    password: hashedPassword,
    phoneNumber: `018${Math.floor(10000000 + Math.random() * 89999999)}`.slice(0, 11),
    role: 'Business',
    parentCompany: company._id,
    externalMerchantId: EXTERNAL_MERCHANT_ID,
    isVerified: true,
    isCompleted: true,
    brandInfo: { brandName: 'Test Merchant' },
    pickUpAdress: {
      country: 'Egypt',
      city: TEST_GOVERNMENT,
      zone: TEST_ZONE,
      adressDetails: '12 Test Street',
      pickupPhone: '01000000000',
    },
    pickUpAddresses: [
      {
        addressName: 'Main Address',
        isDefault: true,
        country: 'Egypt',
        city: TEST_GOVERNMENT,
        zone: TEST_ZONE,
        adressDetails: '12 Test Street',
        pickupPhone: '01000000000',
      },
    ],
  });
  await merchant.save();
  console.log(`  ${c.green}✓${c.reset} Merchant sub-account: ${merchant.businessAccountCode}`);

  // API key for the company (all scopes)
  const { rawKey, keyPrefix, keyHash, lastFour } = generateApiKey();
  const apiKey = await ApiKey.create({
    business: company._id,
    name: `API Test Key ${TAG}`,
    keyPrefix,
    keyHash,
    lastFour,
    scopes: ['orders', 'pickups', 'merchants'],
    isActive: true,
  });
  console.log(`  ${c.green}✓${c.reset} API key created (${keyPrefix}...${lastFour})`);

  const pickupAddressId = merchant.pickUpAddresses?.[0]?.addressId || null;

  seeded = { company, merchant, apiKey, rawKey, pickupAddressId };
  return seeded;
}

async function cleanup() {
  section('Cleanup');
  if (KEEP_DATA) {
    console.log(`  ${c.yellow}Skipped${c.reset} (KEEP_DATA=1). Test data left in DB.`);
    return;
  }
  try {
    const { company, merchant, apiKey } = seeded;
    if (apiKey) await ApiKey.deleteOne({ _id: apiKey._id });
    // Remove any orders/pickups created for the merchant during the test
    const Order = require('../models/order');
    const Pickup = require('../models/pickup');
    if (merchant) {
      await Order.deleteMany({ business: merchant._id });
      await Pickup.deleteMany({ business: merchant._id });
      await User.deleteOne({ _id: merchant._id });
    }
    if (company) await User.deleteOne({ _id: company._id });
    console.log(`  ${c.green}✓${c.reset} Removed seeded company, merchant, key, and their orders/pickups.`);
  } catch (err) {
    console.log(`  ${c.red}✗${c.reset} Cleanup error: ${err.message}`);
  }
}

async function run() {
  header('Now Shipping Public API v1 — Endpoint Test');
  console.log(`  Base URL: ${c.cyan}${BASE_URL}${c.reset}`);
  console.log(`  Time:     ${new Date().toISOString()}`);

  const DB = await resolveDbUri();
  if (!DB) {
    console.error(`\n${c.red}DATABASE_URL is not set in .env${c.reset}`);
    process.exit(1);
  }

  await mongoose.connect(DB);
  console.log(`  ${c.green}✓${c.reset} Connected to MongoDB (${mongoose.connection.name})`);

  await seedTestData();

  const { rawKey, merchant, pickupAddressId } = seeded;
  const auth = { Authorization: `Bearer ${rawKey}` };
  const authMerchant = { ...auth, 'X-Merchant-Id': merchant.businessAccountCode };
  const authExternal = { ...auth, 'X-Merchant-Id': EXTERNAL_MERCHANT_ID };

  // ---- Auth / negative checks ----
  section('Authentication');
  await check('Missing key -> 401', { path: '/ping', headers: {}, expect: [401] });
  await check('Invalid key -> 401', { path: '/ping', headers: { Authorization: 'Bearer nsk_live_invalid' }, expect: [401] });
  await check('Valid key ping', { path: '/ping', headers: auth, expect: [200] });

  // ---- System ----
  section('System & Zones');
  await check('Delivery zones', { path: '/delivery-zones', headers: auth, expect: [200] });

  // ---- Fees ----
  section('Fees (preview)');
  await check('Order fee calculate', {
    method: 'POST',
    path: '/fees/calculate',
    headers: authMerchant,
    body: { government: TEST_GOVERNMENT, orderType: 'Deliver', isExpressShipping: false },
    expect: [200],
  });
  await check('Order fee bad government -> 400', {
    method: 'POST',
    path: '/fees/calculate',
    headers: authMerchant,
    body: { government: 'Atlantis', orderType: 'Deliver' },
    expect: [400],
  });

  // ---- Merchants ----
  section('Merchants (company key)');
  const created = await check('Create merchant', {
    method: 'POST',
    path: '/merchants',
    headers: auth,
    body: {
      name: 'Onboarded Shop',
      email: `onboard_${TAG}@apitest.local`,
      phone: `017${Math.floor(10000000 + Math.random() * 89999999)}`.slice(0, 11),
      brandName: 'Onboarded',
      externalMerchantId: `onboard_${TAG}`,
      pickupAddress: {
        city: TEST_GOVERNMENT,
        zone: TEST_ZONE,
        addressDetails: '5 Onboard St',
        pickupPhone: '01000000000',
      },
    },
    expect: [201],
  });
  const onboardedCode = created.payload?.data?.merchant?.businessAccountCode;

  await check('Create merchant bad zone -> 400', {
    method: 'POST',
    path: '/merchants',
    headers: auth,
    body: {
      name: 'Bad Zone Shop',
      email: `badzone_${TAG}@apitest.local`,
      phone: `016${Math.floor(10000000 + Math.random() * 89999999)}`.slice(0, 11),
      brandName: 'BadZone',
      pickupAddress: { city: TEST_GOVERNMENT, zone: 'Nasr City', addressDetails: 'x', pickupPhone: '01000000000' },
    },
    expect: [400],
  });
  await check('List merchants', { path: '/merchants?limit=10', headers: auth, expect: [200] });
  await check('Get merchant by code', { path: `/merchants/${merchant.businessAccountCode}`, headers: auth, expect: [200] });
  await check('Get merchant by externalId', { path: `/merchants/${EXTERNAL_MERCHANT_ID}`, headers: auth, expect: [200] });

  // ---- Orders ----
  section('Orders');
  await check('Create order missing merchant -> 400', {
    method: 'POST',
    path: '/orders',
    headers: auth,
    body: { fullName: 'x' },
    expect: [400],
  });
  const orderRes = await check('Create order (Deliver)', {
    method: 'POST',
    path: '/orders',
    headers: authMerchant,
    body: {
      fullName: 'Test Customer',
      phoneNumber: '01098765432',
      address: '15 Main St',
      government: TEST_GOVERNMENT,
      zone: TEST_ZONE,
      orderType: 'Deliver',
      productDescription: 'Test product',
      numberOfItems: 1,
      COD: true,
      amountCOD: 250,
      referralNumber: `REF-${TAG}`,
    },
    expect: [201],
  });
  const orderNumber = orderRes.payload?.data?.order?.orderNumber;
  const orderId = orderRes.payload?.data?.order?.orderId;

  await check('Create order bad zone -> 400', {
    method: 'POST',
    path: '/orders',
    headers: authMerchant,
    body: {
      fullName: 'Test',
      phoneNumber: '01098765432',
      address: '1 St',
      government: TEST_GOVERNMENT,
      zone: 'Nasr City',
      orderType: 'Deliver',
      productDescription: 'x',
      numberOfItems: 1,
    },
    expect: [400],
  });
  await check('List orders', { path: '/orders?limit=10', headers: authMerchant, expect: [200] });
  if (orderNumber) {
    await check('Get order', { path: `/orders/${orderNumber}`, headers: authMerchant, expect: [200] });
    await check('Download AWB (PDF)', { path: `/orders/${orderNumber}/awb?size=A4`, headers: authMerchant, expect: [200], expectPdf: true });
  }
  if (orderId) {
    await check('Update order', {
      method: 'PUT',
      path: `/orders/${orderId}`,
      headers: authMerchant,
      body: {
        fullName: 'Test Customer Updated',
        phoneNumber: '01098765432',
        address: '20 Main St',
        government: TEST_GOVERNMENT,
        zone: TEST_ZONE,
        orderType: 'Deliver',
        productDescription: 'Test product',
        numberOfItems: 2,
      },
      expect: [200],
    });
    // Business rule: a `new` order cannot be cancelled (must be deleted instead).
    // The API should reject the cancel with 400 and a clear message.
    await check('Cancel new order -> 400 (guard)', { method: 'POST', path: `/orders/${orderId}/cancel`, headers: authMerchant, expect: [400] });
  }

  // Create a fresh order to test delete (only 'new' orders can be deleted)
  const delOrderRes = await check('Create order for delete', {
    method: 'POST',
    path: '/orders',
    headers: authMerchant,
    body: {
      fullName: 'Delete Me',
      phoneNumber: '01098765432',
      address: '99 Del St',
      government: TEST_GOVERNMENT,
      zone: TEST_ZONE,
      orderType: 'Deliver',
      productDescription: 'To delete',
      numberOfItems: 1,
    },
    expect: [201],
  });
  const delOrderId = delOrderRes.payload?.data?.order?.orderId;
  if (delOrderId) {
    await check('Delete order', { method: 'DELETE', path: `/orders/${delOrderId}`, headers: authMerchant, expect: [200] });
  }

  // ---- Pickups ----
  section('Pickups');
  await check('Pickup fee calculate', {
    method: 'POST',
    path: '/pickups/calculate-fee',
    headers: authMerchant,
    body: { numberOfOrders: 10, pickupAddressId },
    expect: [200],
  });
  const pickupRes = await check('Create pickup', {
    method: 'POST',
    path: '/pickups',
    headers: authExternal, // also verifies externalMerchantId resolution
    body: {
      numberOfOrders: 5,
      pickupDate: getEarliestPickupDateIso(),
      phoneNumber: '01000000000',
      pickupNotes: 'API test pickup',
    },
    expect: [201],
  });
  const pickupNumber = pickupRes.payload?.data?.pickup?.pickupNumber;
  await check('List pickups', { path: '/pickups?limit=10', headers: authMerchant, expect: [200] });
  if (pickupNumber) {
    await check('Get pickup', { path: `/pickups/${pickupNumber}`, headers: authMerchant, expect: [200] });
    await check('Update pickup', {
      method: 'PUT',
      path: `/pickups/${pickupNumber}`,
      headers: authMerchant,
      body: { numberOfOrders: 8, pickupDate: getEarliestPickupDateIso(), phoneNumber: '01000000000' },
      expect: [200],
    });
    // Business rule: a `new` pickup cannot be cancelled (must be deleted instead).
    await check('Cancel new pickup -> 400 (guard)', { method: 'POST', path: `/pickups/${pickupNumber}/cancel`, headers: authMerchant, expect: [400] });
  }

  // Fresh pickup for delete
  const delPickupRes = await check('Create pickup for delete', {
    method: 'POST',
    path: '/pickups',
    headers: authMerchant,
    body: { numberOfOrders: 2, pickupDate: getEarliestPickupDateIso(), phoneNumber: '01000000000' },
    expect: [201],
  });
  const delPickupNumber = delPickupRes.payload?.data?.pickup?.pickupNumber;
  if (delPickupNumber) {
    await check('Delete pickup', { method: 'DELETE', path: `/pickups/${delPickupNumber}`, headers: authMerchant, expect: [200] });
  }

  await cleanup();
  printSummary();
}

function printSummary() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const totalMs = results.reduce((a, r) => a + r.ms, 0);

  header('Summary');
  console.log(`  Total:  ${c.bold}${results.length}${c.reset}`);
  console.log(`  ${c.green}Passed: ${passed}${c.reset}`);
  console.log(`  ${failed ? c.red : c.gray}Failed: ${failed}${c.reset}`);
  console.log(`  ${c.dim}Duration: ${totalMs}ms${c.reset}`);
  console.log('');

  if (failed) {
    console.log(c.red + c.bold + '  Failed checks:' + c.reset);
    results.filter((r) => !r.ok).forEach((r) => {
      console.log(`   ${c.red}✗${c.reset} ${r.method} ${r.path} ${c.dim}[${r.status || 'no response'}]${c.reset}`);
    });
    console.log('');
    console.log(c.bgRed + '  RESULT: SOME TESTS FAILED  ' + c.reset);
  } else {
    console.log(c.bgGreen + c.bold + '  RESULT: ALL TESTS PASSED — ready to send  ' + c.reset);
  }
  console.log('');
}

run()
  .catch((err) => {
    console.error(`\n${c.red}Fatal error:${c.reset}`, err);
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    const failed = results.filter((r) => !r.ok).length;
    process.exit(failed ? 1 : 0);
  });
