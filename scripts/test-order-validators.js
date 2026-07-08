#!/usr/bin/env node
/**
 * Unit tests for order entity validators (quantity grammar, phone, product).
 * Run: node scripts/test-order-validators.js
 */
const {
  extractExplicitQuantity,
  isQuantityExplicitlyStated,
  validateEntity,
  validateEntities,
} = require('../services/ai/order/entityValidators');

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

console.log('=== Quantity grammar ===\n');

assert(extractExplicitQuantity('item count is 1') === 1, 'item count is 1');
assert(extractExplicitQuantity('quantity 2') === 2, 'quantity 2');
assert(extractExplicitQuantity('2 pieces') === 2, '2 pieces');
assert(extractExplicitQuantity('x2') === 2, 'x2');
assert(extractExplicitQuantity('2 iPhone 14') === 2, 'leading 2 iPhone');
assert(extractExplicitQuantity('iPhone 14 Pro Max') === null, 'no qty from product name');
assert(extractExplicitQuantity('Samsung S24 Ultra') === null, 'no qty from S24');
assert(extractExplicitQuantity('RTX 4090') === null, 'no qty from RTX');
assert(extractExplicitQuantity('PlayStation 5') === null, 'no qty from PS5');

console.log('\n=== Product vs quantity validation ===\n');

{
  const r = validateEntity(
    { field: 'numberOfItems', value: 14, confidence: 0.95 },
    { message: 'iPhone 14 Pro Max', pendingField: 'productDescription', lang: 'en' }
  );
  assert(!r.ok && r.error === 'implicit_quantity', 'rejects 14 from iPhone 14 Pro Max');
}

{
  const r = validateEntity(
    { field: 'productDescription', value: 'iPhone 14 Pro Max', confidence: 0.95 },
    { message: 'iPhone 14 Pro Max', lang: 'en' }
  );
  assert(r.ok && r.value === 'iPhone 14 Pro Max', 'accepts full product name');
}

{
  const r = validateEntity(
    { field: 'numberOfItems', value: 1, confidence: 0.95 },
    { message: 'change product to iPhone 14 Pro Max, COD yes, item count is 1', lang: 'en' }
  );
  assert(r.ok && r.value === 1, 'explicit item count 1 in multi-field message');
}

{
  const r = validateEntity(
    { field: 'numberOfItems', value: 2, confidence: 0.95 },
    { message: '2 iPhone 14', pendingField: null, lang: 'en' }
  );
  assert(r.ok && r.value === 2, '2 iPhone 14 → qty 2');
}

console.log('\n=== Phone validation ===\n');

{
  const r = validateEntity(
    { field: 'phoneNumber', value: '01156012078', confidence: 0.99 },
    { message: '01156012078', pendingField: 'phoneNumber' }
  );
  assert(r.ok, 'valid Egyptian mobile');
}

{
  const r = validateEntity(
    { field: 'phoneNumber', value: '12345', confidence: 0.99 },
    { message: '12345', pendingField: 'phoneNumber' }
  );
  assert(!r.ok && r.error === 'invalid_phone', 'invalid phone rejected');
}

console.log('\n=== Low confidence ===\n');

{
  const r = validateEntity(
    { field: 'fullName', value: 'Deif', confidence: 0.5 },
    { message: 'Deif', pendingField: 'fullName' }
  );
  assert(!r.ok && r.needsClarification, 'low confidence triggers clarification');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
