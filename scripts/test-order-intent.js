#!/usr/bin/env node
/**
 * Unit tests for order intent classifier.
 * Run: node scripts/test-order-intent.js
 */
const {
  classifyOrderIntent,
  detectCorrectionVerb,
} = require('../services/ai/order/intentClassifier');

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

console.log('=== Intent classifier ===\n');

assert(detectCorrectionVerb('change product to iPhone'), 'detects change');
assert(detectCorrectionVerb('غير العنوان'), 'detects Arabic correction');
assert(!detectCorrectionVerb('01156012078'), 'phone is not correction');

{
  const r = classifyOrderIntent({
    message: 'change product to iPhone 14 Pro Max, COD yes, quantity 1',
    pendingField: 'codConfirmation',
    extractionResult: { orderIntent: 'update', correction: true },
    hasDraft: true,
  });
  assert(r.intent === 'update' && r.correction, 'multi-field update intent');
}

{
  const r = classifyOrderIntent({
    message: '01156012078',
    pendingField: 'phoneNumber',
    extractionResult: { orderIntent: 'answer_question' },
    hasDraft: true,
  });
  assert(r.intent === 'answer_question', 'scalar answer to pending field');
}

{
  const r = classifyOrderIntent({
    message: 'تأكيد الأوردر',
    pendingField: null,
    extractionResult: {},
    hasDraft: true,
  });
  assert(r.intent === 'confirm', 'confirm phrase');
}

{
  const r = classifyOrderIntent({
    message: 'cancel',
    pendingField: null,
    extractionResult: {},
    hasDraft: true,
  });
  assert(r.intent === 'cancel', 'cancel phrase');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
