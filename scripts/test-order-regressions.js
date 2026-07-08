#!/usr/bin/env node
/**
 * Regression tests for AINOW order pipeline (screenshot failures + brief scenarios).
 * Run: node scripts/test-order-regressions.js
 */
const { classifyOrderIntent } = require('../services/ai/order/intentClassifier');
const { validateEntities, extractExplicitQuantity } = require('../services/ai/order/entityValidators');
const { resolveConflicts } = require('../services/ai/order/conflictResolver');
const { applyEntities } = require('../services/ai/order/orderState');
const { normalizeDraftFields } = require('../services/ai/textNormalizer');
const { extractPostStructuralFallback } = require('../services/ai/order/entityExtractor');

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

function simulateCorrectionTurn(existing, message, entities, pendingField) {
  const { intent, correction } = classifyOrderIntent({
    message,
    pendingField,
    extractionResult: { orderIntent: 'update', correction: true },
    hasDraft: true,
  });
  const { validated } = validateEntities(entities, {
    message,
    pendingField,
    draft: existing,
    lang: 'en',
  });
  const decisions = resolveConflicts({
    existingDraft: existing,
    validatedEntities: validated,
    intent,
    correction,
    pendingField,
  });
  return applyEntities(existing, decisions);
}

console.log('=== Screenshot regression: iPhone 14 qty bug ===\n');

{
  const existing = {
    fullName: 'Deif Mohamed',
    phoneNumber: '01156012078',
    address: '1 medan opera buldiin 1',
    government: 'Cairo',
    zone: 'Abdeen - Downtown Cairo',
    productDescription: 'iphone 14 pro mac',
    numberOfItems: 14,
    codConfirmed: false,
  };
  const message =
    'change the product description to iphone 14 pro max and is is COD yes and the itme is 1';
  const entities = [
    { field: 'productDescription', value: 'iPhone 14 Pro Max', confidence: 0.95 },
    { field: 'numberOfItems', value: 1, confidence: 0.95 },
    { field: 'codConfirmed', value: 'true', confidence: 0.95 },
  ];
  const next = simulateCorrectionTurn(existing, message, entities, 'codConfirmation');
  assert(next.productDescription === 'iPhone 14 Pro Max', 'product corrected to Pro Max');
  assert(next.numberOfItems === 1, 'quantity corrected to 1 not 14');
  assert(next.codConfirmed === true && next.COD === true, 'COD set to yes');
}

console.log('\n=== Product name must not infer quantity ===\n');

{
  const normalized = normalizeDraftFields(
    { productDescription: 'iPhone 14 Pro Max' },
    'en'
  );
  assert(!normalized.numberOfItems, 'normalizeDraftFields does not infer qty from product');
}

{
  const entities = extractPostStructuralFallback('iPhone 14 Pro Max', 'productDescription');
  assert(entities[0]?.value === 'iPhone 14 Pro Max', 'product fallback keeps full name');
  assert(!entities.some((e) => e.field === 'numberOfItems'), 'no qty from product fallback');
}

console.log('\n=== Multi-field update ===\n');

{
  const existing = {
    fullName: 'Deif',
    phoneNumber: '01156012078',
    address: 'old address',
    productDescription: 'shirt',
    numberOfItems: 2,
  };
  const message =
    'Change product to iPhone 14 Pro Max, COD yes, quantity 1, address 12 Tahrir Street';
  const entities = [
    { field: 'productDescription', value: 'iPhone 14 Pro Max', confidence: 0.95 },
    { field: 'numberOfItems', value: 1, confidence: 0.95 },
    { field: 'codConfirmed', value: 'true', confidence: 0.95 },
    { field: 'address', value: '12 Tahrir Street', confidence: 0.9 },
  ];
  const next = simulateCorrectionTurn(existing, message, entities, null);
  assert(next.productDescription === 'iPhone 14 Pro Max', 'updates product only');
  assert(next.numberOfItems === 1, 'updates quantity');
  assert(next.address === '12 Tahrir Street', 'updates address');
  assert(next.fullName === 'Deif', 'does not touch name');
}

console.log('\n=== Explicit quantity patterns ===\n');

assert(extractExplicitQuantity('الكمية ٢') === 2 || extractExplicitQuantity('عدد 2') === 2, 'Arabic quantity');
assert(extractExplicitQuantity('Need 5 bags') === 5, 'Need 5 bags');

console.log('\n=== Phone with spaces ===\n');

{
  const { validated } = validateEntities(
    [{ field: 'phoneNumber', value: '0115 601 2078', confidence: 0.95 }],
    { message: '0115 601 2078', pendingField: 'phoneNumber' }
  );
  assert(validated[0]?.value === '01156012078', 'strips spaces from phone');
}

console.log('\n=== Short message scalar answer ===\n');

{
  const entities = extractPostStructuralFallback('3', 'numberOfItems');
  assert(entities[0]?.value === 3, 'short number answers item count when pending');
}

console.log('\n=== Arabic COD yes/no (نعم / لا) ===\n');

{
  const { detectCodConfirmation } = require('../services/ai/clarificationEngine');
  assert(detectCodConfirmation('نعم')?.COD === true, 'نعم detects COD yes');
  assert(detectCodConfirmation('لا')?.COD === false, 'لا detects COD no');
  const { validated } = validateEntities(
    [{ field: 'codConfirmed', value: true, confidence: 0.95 }],
    { message: 'نعم', pendingField: 'codConfirmation', lang: 'ar' }
  );
  assert(validated[0]?.COD === true, 'validates COD yes from نعم');
}

console.log('\n=== Sticky Arabic during order draft ===\n');

{
  const { resolveConversationLang } = require('../services/ai/conversationLang');
  const conversation = {
    activeDraft: {
      type: 'order',
      fields: {
        fullName: 'ضيف محمد',
        address: '1 ميدان الاوبرا',
        productDescription: 'ايفون 14 برو ماكس',
      },
    },
    messages: [{ sender: 'user', content: 'عايز اعمل اوردر' }],
  };
  assert(
    resolveConversationLang(conversation, 'en', '1000') === 'ar',
    'digits-only reply stays Arabic when draft is Arabic'
  );
  assert(
    resolveConversationLang(conversation, 'en', 'Express delivery') === 'ar',
    'English quick-reply token stays Arabic when draft is Arabic'
  );
}

console.log('\n=== Egyptian phone parsing ===\n');

{
  const {
    parsePhoneFieldsFromText,
    sanitizePhoneFields,
  } = require('../services/ai/phoneFieldUtils');
  const { extractFromUserReply } = require('../services/ai/clarificationEngine');
  const { isValidEgyptianMobile } = require('../utils/ainowDraftValidation');

  const ar = parsePhoneFieldsFromText('٠01156012078', {}, 'phoneNumber');
  assert(ar.phoneNumber === '01156012078', 'Arabic-indic phone normalizes');

  const sec = parsePhoneFieldsFromText('وعنده رقم تاني 01003202768', { phoneNumber: '01156012078' }, 'zone');
  assert(sec.otherPhoneNumber === '01003202768', 'secondary phone on follow-up message');

  const fixed = sanitizePhoneFields({ phoneNumber: '0115601207801003202768' });
  assert(fixed.phoneNumber === '01156012078' && fixed.otherPhoneNumber === '01003202768', 'concatenated phones split');

  assert(!isValidEgyptianMobile('0115601207801003202768'), 'concatenated phone rejected');

  const zoneStep = extractFromUserReply('وعنده رقم تاني 01003202768', 'zone', { phoneNumber: '01156012078' }, {});
  assert(zoneStep.otherPhoneNumber === '01003202768' && !zoneStep.zoneQuery, 'secondary phone does not become zone');
}

console.log('\n=== Shipping after no-COD ===\n');

{
  const { mergeDraft, getClarificationQueue, isDraftComplete } = require('../services/ai/orderDraftService');
  const { extractFromUserReply } = require('../services/ai/clarificationEngine');
  const userData = { pickUpAddresses: [{ addressId: 'pickup-1' }] };

  let draft = {
    fullName: 'حسام محمد حسن',
    phoneNumber: '01156012078',
    address: '١ ميدان الاوبرا',
    government: 'Cairo',
    zone: 'Abdeen - ElAtaba',
    productDescription: 'iphone 14 pro max',
    numberOfItems: 1,
    codConfirmed: true,
    COD: false,
  };

  const ext = extractFromUserReply('توصيل سريع', 'shippingSpeed', draft, {});
  draft = mergeDraft(draft, ext, 'ar', { allowPostStructuralFromExtract: true, userData });

  assert(draft.isExpressShipping === true, 'express shipping saved when COD is no');
  assert(draft.shippingSpeedConfirmed === true, 'shipping confirmed when COD is no');
  assert(getClarificationQueue(draft, userData).length === 0, 'draft complete after express with single pickup');
  assert(isDraftComplete(draft, userData), 'isDraftComplete after no-COD express');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
