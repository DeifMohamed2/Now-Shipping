#!/usr/bin/env node
/**
 * Verify sub-business pricing inherits from parent company (one-way).
 *
 * Usage: node scripts/test-pricing-inheritance.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/user');
const { resolveEffectivePricing } = require('../utils/effectivePricing');
const { calculateOrderFee } = require('../utils/fees');
const orderService = require('../services/orderService');
const pickupService = require('../services/pickupService');

const TAG = `pricing_test_${Date.now()}`;
let createdIds = { company: null, merchant: null };

async function seed() {
  const hashedPassword = await require('bcrypt').hash(crypto.randomBytes(16).toString('hex'), 10);

  const company = await User.create({
    name: 'Pricing Test Co',
    email: `pricing_co_${TAG}@test.local`,
    password: hashedPassword,
    phoneNumber: `019${Math.floor(10000000 + Math.random() * 89999999)}`.slice(0, 11),
    role: 'Business',
    isCompanyAccount: true,
    isVerified: true,
    isCompleted: true,
    brandInfo: { brandName: 'Pricing Test Co' },
    customPricing: {
      enabled: true,
      order: {
        Cairo: { Deliver: 77, Return: 77, Exchange: 77 },
        Giza: { Deliver: 77, Return: 77, Exchange: 77 },
        Qalyubia: { Deliver: 77, Return: 77, Exchange: 77 },
      },
      expressFee: 177,
      pickupFee: 55,
    },
  });

  const merchant = await User.create({
    name: 'Pricing Test Merchant',
    email: `pricing_m_${TAG}@test.local`,
    password: hashedPassword,
    phoneNumber: `018${Math.floor(10000000 + Math.random() * 89999999)}`.slice(0, 11),
    role: 'Business',
    parentCompany: company._id,
    isVerified: true,
    isCompleted: true,
    brandInfo: { brandName: 'Sub Merchant' },
    customPricing: {
      enabled: true,
      order: {
        Cairo: { Deliver: 11, Return: 11, Exchange: 11 },
        Giza: { Deliver: 11, Return: 11, Exchange: 11 },
        Qalyubia: { Deliver: 11, Return: 11, Exchange: 11 },
      },
      expressFee: 11,
      pickupFee: 11,
    },
    pickUpAdress: { city: 'Cairo', zone: 'Test', adressDetails: '1 St', pickupPhone: '01000000000' },
    pickUpAddresses: [
      {
        addressName: 'Main',
        isDefault: true,
        city: 'Cairo',
        zone: 'Test',
        adressDetails: '1 St',
        pickupPhone: '01000000000',
      },
    ],
  });

  createdIds = { company: company._id, merchant: merchant._id };
  return { company, merchant };
}

async function cleanup() {
  if (createdIds.merchant) await User.deleteOne({ _id: createdIds.merchant });
  if (createdIds.company) await User.deleteOne({ _id: createdIds.company });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log(`  ✓ ${msg}`);
}

async function run() {
  console.log('\n=== Pricing inheritance test ===\n');
  await mongoose.connect(process.env.DATABASE_URL);
  const { company, merchant } = await seed();

  const pricing = await resolveEffectivePricing(merchant);
  assert(pricing && pricing.enabled, 'resolveEffectivePricing returns enabled pricing for sub-account');
  assert(pricing.order.Cairo.Deliver === 77, 'Sub-account inherits parent Deliver fee (77, not 11)');

  const orderFee = calculateOrderFee('Cairo', 'Deliver', false, pricing);
  assert(orderFee === 77, `calculateOrderFee uses parent pricing (${orderFee} EGP)`);

  const feeResult = await orderService.calculateOrderFeesForBusiness(merchant, {
    government: 'Cairo',
    orderType: 'Deliver',
    isExpressShipping: false,
  });
  assert(feeResult.ok && feeResult.fee === 77, `orderService fee preview returns parent fee (${feeResult.fee})`);

  const pickupResult = await pickupService.calculatePickupFeeForBusiness(merchant, {
    numberOfOrders: 5,
  });
  assert(pickupResult.fee === 55, `pickupService fee uses parent pickup fee (${pickupResult.fee})`);

  const parentPricing = await resolveEffectivePricing(company);
  assert(parentPricing.order.Cairo.Deliver === 77, 'Parent company uses its own pricing');

  await cleanup();
  console.log('\nRESULT: ALL PRICING INHERITANCE TESTS PASSED\n');
}

run()
  .catch(async (err) => {
    console.error('\nFAILED:', err.message);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
