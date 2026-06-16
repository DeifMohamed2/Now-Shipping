#!/usr/bin/env node
/**
 * Regression tests for AINOW zone step and draft continuity.
 * Run: node scripts/test-ainow-zone-draft.js
 */
const { getClarificationQueue } = require('../services/ai/orderDraftService');
const { applyRegionResolution } = require('../services/ai/regionResolver');
const { buildAcknowledgment } = require('../services/ai/clarificationEngine');
const { isZoneLikeMessage } = require('../utils/zoneReplyDetection');
const {
  shouldRoutePlatformHelp,
  buildZonePickResponse,
  buildZonePickMessage,
} = require('../services/ai/assistantOrchestrator');

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

const userData = { pickUpAddresses: [] };

const conversation = {
  activeDraft: {
    type: 'order',
    fields: {},
    missingFields: [],
    pendingField: null,
  },
};

function run() {
  console.log('=== Defer zone picker until phone collected ===\n');

  const draftEarly = {
    orderType: 'Deliver',
    fullName: 'ضيف محمد',
    zoneQuery: 'المعادي',
  };
  const queueEarly = getClarificationQueue(draftEarly, userData);
  assert(queueEarly[0] === 'phoneNumber', 'phone is first missing field when zoneQuery stored');

  const { regionHints } = applyRegionResolution({ ...draftEarly }, { splitAddress: true });
  const hasZoneSuggestions = !!(regionHints.zoneSuggestions || regionHints.ambiguousOptions)?.length;
  assert(hasZoneSuggestions, 'معادي produces zone suggestions');
  assert(queueEarly[0] !== 'zone', 'zone picker should not be active yet');

  console.log('\n=== buildZonePickResponse copy ===\n');

  const zoneMsg = buildZonePickMessage(
    { fullName: 'ضيف محمد' },
    'في أكثر من منطقة قريبة من «المعادي». اختر الأنسب:',
    'ar'
  );
  assert(zoneMsg.includes('ضيف محمد'), 'zone pick message includes customer name');
  assert(zoneMsg.includes('المعادي'), 'zone pick message includes query');
  assert(!/رقم|تليفون|موبايل/i.test(zoneMsg), 'zone pick message does not ask for phone');

  const pickResponse = buildZonePickResponse({
    suggestions: [
      { labelAr: 'المعادي - دجله', labelEn: 'Maadi - Degla', government: 'Cairo', zone: 'Maadi - Degla' },
    ],
    query: 'المعادي',
    lang: 'ar',
    reason: 'ambiguous',
    draftFields: draftEarly,
    userData,
    conversation,
  });
  assert(pickResponse.intent === 'clarify_order', 'zone pick is clarify_order');
  assert(!pickResponse.clarifyingQuestion, 'no duplicate clarifyingQuestion');
  assert(pickResponse.text.includes('اختر الأنسب'), 'single cohesive zone question in text');
  assert(!/رقم|تليفون/i.test(pickResponse.text), 'zone pick text does not mention phone');
  assert(
    pickResponse.draft.missingFields.includes('phoneNumber'),
    'full missing queue preserved on zone pick response'
  );

  console.log('\n=== Active draft blocks mistaken platform help ===\n');

  const orderDraft = { activeDraft: { type: 'order', fields: { fullName: 'Test' } } };
  const geminiHelp = { intent: 'platform_help', helpTopic: 'zones_areas', extractedFields: {} };
  assert(
    !shouldRoutePlatformHelp('المعادي - دجله', geminiHelp, orderDraft, userData),
    'zone label during order draft does not route to platform help'
  );
  assert(
    shouldRoutePlatformHelp('ازاي اختار المنطقة', geminiHelp, orderDraft, userData),
    'explicit help question still allowed during draft'
  );

  console.log('\n=== Zone acknowledgment ===\n');

  assert(
    buildAcknowledgment('zone', 'ar').includes('المنطقة'),
    'zone acknowledgment in Arabic'
  );

  console.log('\n=== Zone-like message never shows zones_areas help ===\n');

  const { detectPlatformHelp } = require('../services/ai/platformHelpEngine');
  assert(isZoneLikeMessage('المعادي'), 'المعادي is zone-like');
  assert(!detectPlatformHelp('المعادي', {}, userData), 'bare المعادي does not trigger help');

  const zoneOrderDraft = { activeDraft: { type: 'order', fields: { fullName: 'Test' }, pendingField: 'zone' } };
  const geminiZonesHelp = { intent: 'platform_help', helpTopic: 'zones_areas', extractedFields: {} };
  assert(
    !shouldRoutePlatformHelp('المعادي', geminiZonesHelp, zoneOrderDraft, userData),
    'Gemini zones_areas blocked when user sends zone name during order'
  );
  assert(
    !shouldRoutePlatformHelp('المعادي', geminiZonesHelp, {}, userData),
    'Gemini zones_areas blocked for bare zone-like message without draft'
  );

  console.log('\n=== Done ===');
  console.log('Passed:', passed, '| Failed:', failed);
  process.exit(failed > 0 ? 1 : 0);
}

run();
