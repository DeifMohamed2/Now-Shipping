#!/usr/bin/env node
/**
 * Unit tests for AINOW draft ready validation.
 * Run: node scripts/test-ainow-draft-validation.js
 */
const { validateOrderDraftReady, isConfirmOrderPhrase, isCancelDraftPhrase } = require('../utils/ainowDraftValidation');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  OK:', message);
  } else {
    failed++;
    console.error('  FAIL:', message);
  }
}

const completeDeliver = {
  orderType: 'Deliver',
  fullName: 'Ahmed',
  phoneNumber: '01012345678',
  address: '1 Opera Square',
  government: 'Cairo',
  zone: 'Abdeen - Downtown Cairo',
  productDescription: '2 shirts',
  numberOfItems: 2,
  codConfirmed: true,
  COD: false,
  shippingSpeedConfirmed: true,
  isExpressShipping: false,
};

const userDataNoPickup = { pickUpAddresses: [] };

async function run() {
  console.log('=== Order draft ready ===\n');

  {
    const ready = await validateOrderDraftReady(completeDeliver, userDataNoPickup, 'en', null);
    assert(ready.ok, 'valid deliver draft passes ready gate');
  }

  {
    const badType = { ...completeDeliver, orderType: 'Delivery' };
    const ready = await validateOrderDraftReady(badType, userDataNoPickup, 'en', null);
    assert(!ready.ok, 'invalid order type blocked at ready gate');
  }

  {
    const returnFields = {
      orderType: 'Return',
      fullName: 'Ahmed',
      phoneNumber: '01012345678',
      address: '1 St',
      government: 'Cairo',
      zone: 'Abdeen - Downtown Cairo',
      productDescription: 'shirt',
      numberOfItems: 1,
      originalOrderNumber: '123456',
      returnReason: 'defective',
    };
    const ready = await validateOrderDraftReady(returnFields, userDataNoPickup, 'en', null);
    assert(!ready.ok && ready.needsSettings, 'return without pickup address blocked');
  }

  {
    const badPhone = { ...completeDeliver, phoneNumber: '123' };
    const ready = await validateOrderDraftReady(badPhone, userDataNoPickup, 'en', null);
    assert(!ready.ok, 'invalid phone blocked');
  }

  console.log('\n=== Confirm phrase helpers ===\n');

  assert(isConfirmOrderPhrase('تأكيد الأوردر'), 'confirm order phrase ar');
  assert(isConfirmOrderPhrase('Confirm order'), 'confirm order phrase en');
  assert(isCancelDraftPhrase('إلغاء'), 'cancel phrase ar');
  assert(isCancelDraftPhrase('cancel'), 'cancel phrase en');

  console.log('\n=== Summary ===\n');
  console.log('Passed:', passed, '| Failed:', failed);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
