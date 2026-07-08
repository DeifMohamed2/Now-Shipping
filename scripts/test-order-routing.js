#!/usr/bin/env node
/**
 * Deterministic tests for AINOW message routing (order vs pickup vs COD).
 * Run: node scripts/test-order-routing.js
 */
const {
  routeMessage,
  isCodPhrase,
  isOrderCreateMessage,
  isPickupStatusMessage,
} = require('../services/ai/order/messageRouter');
const { isPickupStatusQuery } = require('../services/ai/assistantOrchestrator');

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

function assertRoute(message, geminiResult, conversation, expectedRoute) {
  const route = routeMessage({ message, conversation, geminiResult });
  assert(
    route.route === expectedRoute,
    `"${message.slice(0, 40)}..." → ${route.route} (expected ${expectedRoute})`
  );
  return route;
}

const SCREENSHOT_MSG =
  'كنت عايز اعمل اوردر رايح المعادي باسم محمد ضيف رقمه 01156012078 طالب ايفون 14 برو ماكس عند الدفع عند الاستلام';

console.log('=== COD phrase detection ===\n');

assert(isCodPhrase('عند الدفع عند الاستلام'), 'COD: عند الدفع عند الاستلام');
assert(isCodPhrase('cash on delivery'), 'COD: cash on delivery');
assert(isCodPhrase('COD'), 'COD: COD keyword');
assert(!isCodPhrase('فين استلام 123456'), 'COD: not pickup status query');

console.log('\n=== Order create vs pickup status ===\n');

assertRoute(SCREENSHOT_MSG, { intent: 'pickup_status' }, {}, 'order_create');
assert(
  !isPickupStatusMessage(SCREENSHOT_MSG, { intent: 'pickup_status' }),
  'screenshot message is NOT pickup status'
);
assert(
  !isPickupStatusQuery(SCREENSHOT_MSG, { intent: 'pickup_status', pickupNumberQuery: '01156012078' }),
  'isPickupStatusQuery rejects screenshot order with COD phone'
);

assertRoute('عاوز اعمل اوردر', { intent: 'general_chat' }, {}, 'order_create');
assert(isOrderCreateMessage('عاوز اعمل اوردر', {}), 'isOrderCreateMessage: عاوز اعمل اوردر');

assertRoute('فين استلام 123456', { intent: 'pickup' }, {}, 'pickup_status');
assertRoute('pickup status 123456', { intent: 'general_chat' }, {}, 'pickup_status');
assert(
  isPickupStatusQuery('فين استلام 123456', { intent: 'pickup' }),
  'isPickupStatusQuery accepts فين استلام 123456'
);

assertRoute('عايز اجدول استلام', { intent: 'pickup' }, {}, 'pickup_create');

console.log('\n=== Active draft continuation ===\n');

assertRoute(
  'المعادي',
  { intent: 'general_chat' },
  { activeDraft: { type: 'order', fields: {} } },
  'order_continue'
);
assertRoute(
  '10',
  { intent: 'general_chat' },
  { activeDraft: { type: 'pickup', fields: {} } },
  'pickup_continue'
);

console.log('\n=== Gemini intent fallbacks ===\n');

assertRoute('check wallet', { intent: 'wallet' }, {}, 'wallet');
assertRoute('order status 99999', { intent: 'order_status', orderNumberQuery: '99999' }, {}, 'order_status');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
