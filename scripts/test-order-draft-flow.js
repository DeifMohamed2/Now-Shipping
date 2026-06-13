#!/usr/bin/env node
/**
 * Regression tests for AINOW order draft flow (COD order, product language, secondary phone).
 * Run: node scripts/test-order-draft-flow.js
 */
const {
  mergeDraft,
  enforcePostStructuralOrder,
  getClarificationQueue,
  buildCollectedChips,
} = require('../services/ai/orderDraftService');
const { extractFromUserReply, extractSecondaryPhone } = require('../services/ai/clarificationEngine');
const { normalizeProductDescription } = require('../services/ai/textNormalizer');

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

const completeStructural = {
  orderType: 'Deliver',
  fullName: 'Ahmed',
  phoneNumber: '01012345678',
  address: '1 Opera Square',
  government: 'Cairo',
  zone: 'Abdeen - Downtown Cairo',
  productDescription: '2 shirts',
  numberOfItems: 2,
};

const userData = { pickUpAddresses: [] };

console.log('=== Post-structural gating ===\n');

console.log('Gemini bulk extract with early COD + shipping — queue starts at codConfirmation');
{
  const merged = mergeDraft(
    completeStructural,
    {
      COD: true,
      codConfirmed: true,
      amountCOD: 500,
      isExpressShipping: false,
      shippingSpeedConfirmed: true,
    },
    'ar'
  );
  const queue = getClarificationQueue(merged, userData);
  assert(queue[0] === 'codConfirmation', 'first step is codConfirmation (got: ' + queue[0] + ')');
  assert(!merged.shippingSpeedConfirmed, 'shippingSpeedConfirmed stripped');
  assert(!merged.codConfirmed, 'codConfirmed stripped');
}

console.log('\n=== Product input language ===\n');

console.log('English product with Arabic conversation lang');
{
  const result = normalizeProductDescription('2 tshirt', 'ar');
  assert(result === '2 shirts', '2 tshirt stays English (got: ' + result + ')');
}

console.log('\nmergeDraft 2 tshirt with lang ar');
{
  const merged = mergeDraft({}, { productDescription: '2 tshirt' }, 'ar');
  assert(merged.productDescription === '2 shirts', 'merged product stays 2 shirts');
}

console.log('\n=== Secondary phone ===\n');

console.log('رقم تاني 01001234567');
{
  const phone = extractSecondaryPhone('رقم تاني 01001234567', { phoneNumber: '01012345678' });
  assert(phone === '01001234567', 'extracts alternate phone (got: ' + phone + ')');
}

console.log('\nextractFromUserReply sets otherPhoneNumber');
{
  const extracted = extractFromUserReply(
    'رقم تاني 01001234567',
    'address',
    { phoneNumber: '01012345678' },
    {}
  );
  assert(extracted.otherPhoneNumber === '01001234567', 'otherPhoneNumber in extract');
}

console.log('\n=== Chips / shipping premature ===\n');

console.log('After COD yes, before amount — no shipping chip');
{
  const fields = enforcePostStructuralOrder(
    {
      ...completeStructural,
      codConfirmed: true,
      COD: true,
      shippingSpeedConfirmed: true,
      isExpressShipping: false,
    },
    userData
  );
  const queue = getClarificationQueue(fields, userData);
  assert(queue[0] === 'amountCOD', 'queue at amountCOD');
  const chips = buildCollectedChips(fields, queue, 'ar');
  const hasShipping = chips.some((c) => c.key === 'shippingSpeed');
  assert(!hasShipping, 'no shipping chip before amountCOD');
  assert(!fields.shippingSpeedConfirmed, 'shippingSpeedConfirmed stripped');
}

console.log('\n=== Summary ===\n');
console.log('Passed:', passed, '| Failed:', failed);
process.exit(failed > 0 ? 1 : 0);
