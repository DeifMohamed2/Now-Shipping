#!/usr/bin/env node
/**
 * Unit tests for order conflict resolution.
 * Run: node scripts/test-order-conflict.js
 */
const { resolveConflicts } = require('../services/ai/order/conflictResolver');
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

const existing = {
  fullName: 'Deif Mohamed',
  phoneNumber: '01156012078',
  productDescription: 'iphone 14 pro mac',
  numberOfItems: 14,
};

console.log('=== Conflict resolution ===\n');

{
  const decisions = resolveConflicts({
    existingDraft: existing,
    validatedEntities: [
      { field: 'productDescription', value: 'iPhone 14 Pro Max', confidence: 0.95, ok: true },
      { field: 'numberOfItems', value: 1, confidence: 0.95, ok: true },
      { field: 'codConfirmed', value: true, confidence: 0.95, ok: true, COD: true },
    ],
    intent: 'update',
    correction: true,
    deleteFields: [],
    pendingField: 'codConfirmation',
  });
  const next = applyEntities(existing, decisions);
  assert(next.productDescription === 'iPhone 14 Pro Max', 'updates product on correction');
  assert(next.numberOfItems === 1, 'updates quantity on correction');
  assert(next.COD === true, 'updates COD on correction');
  assert(next.fullName === 'Deif Mohamed', 'keeps untouched fullName');
}

{
  const decisions = resolveConflicts({
    existingDraft: existing,
    validatedEntities: [
      { field: 'phoneNumber', value: '01001234567', confidence: 0.95, ok: true },
    ],
    intent: 'answer_question',
    correction: false,
    pendingField: 'phoneNumber',
  });
  assert(decisions.length === 1 && decisions[0].action === 'replace', 'replaces pending phone');
}

{
  const decisions = resolveConflicts({
    existingDraft: existing,
    validatedEntities: [
      { field: 'fullName', value: 'Someone Else', confidence: 0.95, ok: true },
    ],
    intent: 'answer_question',
    correction: false,
    pendingField: 'phoneNumber',
  });
  assert(decisions.length === 0, 'does not overwrite name when answering phone');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
