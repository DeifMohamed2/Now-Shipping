#!/usr/bin/env node
/**
 * Unit tests for AINOW platform help engine and scope guard.
 * Run: node scripts/test-platform-help.js
 */
const {
  detectPlatformHelp,
  buildPlatformHelpResponse,
  isHelpQuestion,
} = require('../services/ai/platformHelpEngine');
const { shouldRefuse } = require('../services/ai/scopeGuard');

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

const userDataNoAddress = { pickUpAddresses: [] };

const pickupDraftConversation = {
  activeDraft: {
    type: 'pickup',
    pendingField: 'pickupAddressId',
    fields: { pickupDate: '2026-06-08' },
    missingFields: ['pickupAddressId'],
  },
};

function run() {
  console.log('=== Screenshot scenario (pickup address blocked) ===\n');

  const msg = 'ممكن تشرحلي ازاي اقدر اروح اعملها';
  const detected = detectPlatformHelp(msg, pickupDraftConversation, userDataNoAddress);
  assert(detected && detected.topicId === 'add_pickup_address', 'help phrase + pickupAddressId draft → add_pickup_address');

  const response = buildPlatformHelpResponse(detected.topicId, 'ar', {
    conversation: pickupDraftConversation,
    userData: userDataNoAddress,
  });
  assert(response.intent === 'platform_help', 'response intent is platform_help');
  assert(response.helpGuide && response.helpGuide.steps.length >= 3, 'help guide has numbered steps');
  assert(
    (response.actions || []).some(function (a) { return a.url && a.url.includes('/business/settings'); }),
    'settings deep link action present'
  );
  assert(response.draft && response.draft.type === 'pickup', 'active pickup draft preserved in help response');

  console.log('\n=== Explicit English help ===\n');

  const createDetected = detectPlatformHelp('how do I create an order', {}, userDataNoAddress);
  assert(createDetected && createDetected.topicId === 'create_order', '"how do I create an order" → create_order');

  console.log('\n=== Scope guard ===\n');

  assert(isHelpQuestion('ممكن تشرحلي ازاي اقدر اروح اعملها'), 'isHelpQuestion recognizes Arabic help phrase');
  assert(!shouldRefuse(msg, { intent: 'general_chat' }), 'scope guard allows help phrase even with general_chat');
  assert(!shouldRefuse(msg, { intent: 'platform_help' }), 'scope guard allows platform_help intent');
  assert(shouldRefuse("what's the weather", { intent: 'general_chat' }), 'off-topic weather still refused');

  console.log('\n=== Help during active draft does not imply draft clear ===\n');

  assert(
    response.draft && response.draft.complete === false,
    'help response keeps draft incomplete for resume'
  );
  assert(
    (response.suggestions || []).some(function (s) { return /كمّل|continue/i.test(s); }),
    'resume pickup suggestion offered after help'
  );

  console.log('\n=== Done ===');
  console.log('Passed:', passed, '| Failed:', failed);
  process.exit(failed > 0 ? 1 : 0);
}

run();
