#!/usr/bin/env node
/**
 * Unit tests for order state reducer.
 * Run: node scripts/test-order-state.js
 */
const { applyEntities } = require('../services/ai/order/orderState');

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

console.log('=== Order state reducer ===\n');

{
  const next = applyEntities(
    { fullName: 'Ahmed', phoneNumber: '01012345678' },
    [
      { field: 'address', action: 'replace', value: '12 Tahrir Street' },
      { field: 'zoneQuery', action: 'replace', value: 'Downtown' },
    ]
  );
  assert(next.address === '12 Tahrir Street', 'applies address');
  assert(next.zoneQuery === 'Downtown', 'applies zoneQuery');
  assert(next.fullName === 'Ahmed', 'preserves existing fields');
}

{
  const next = applyEntities(
    { COD: true, amountCOD: 500, codConfirmed: true },
    [{ field: 'codConfirmed', action: 'delete' }]
  );
  assert(next.codConfirmed === false && next.COD === false, 'delete codConfirmed clears COD');
}

{
  const next = applyEntities(
    { government: 'Cairo', zone: 'Maadi' },
    [{ field: 'zoneQuery', action: 'replace', value: 'Abdeen' }]
  );
  assert(next.zoneQuery === 'Abdeen', 'sets zoneQuery');
  assert(!next.government && !next.zone, 'clears resolved zone on zoneQuery replace');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
