#!/usr/bin/env node
/**
 * Regression tests for AINOW pickup scheduling flow.
 * Run: node scripts/test-pickup-draft-flow.js
 */
const {
  mergePickupDraft,
  getPickupClarificationQueue,
  getPickupDraftProgress,
  isPickupDraftComplete,
  buildPickupChips,
  validatePickupDate,
  applyPickupDraftDefaults,
} = require('../services/ai/pickupDraftService');
const {
  extractPickupFieldsFromMessage,
  parsePickupDate,
  buildPickupStructuredField,
  validatePickupOrderCount,
} = require('../services/ai/pickupClarificationEngine');
const { shouldStartPickupDraft, isPickupStatusQuery } = require('../services/ai/assistantOrchestrator');
const { getEarliestPickupDateIso } = require('../utils/pickupDatePolicy');
const { validatePickupDraftReady, isConfirmPickupPhrase } = require('../utils/ainowDraftValidation');
const { hasUsablePickupAddress } = require('../utils/pickupAddressValidation');

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

const userData = {
  phoneNumber: '01012345678',
  pickUpAddresses: [
    {
      addressId: 'addr-1',
      addressName: 'Main',
      adressDetails: '1 Test St',
      city: 'Cairo',
      country: 'Egypt',
      isDefault: true,
      pickupPhone: '01012345678',
    },
  ],
};

const userContext = {
  pickupAddresses: [{ addressId: 'addr-1', label: 'Main', isDefault: true }],
};

console.log('=== Pickup intent routing ===\n');

assert(
  shouldStartPickupDraft('عايز أجدول استلام', { intent: 'pickup' }, { activeDraft: {} }),
  'schedule pickup starts draft from Arabic phrase'
);
assert(
  shouldStartPickupDraft('Schedule a new pickup', { intent: 'pickup' }, { activeDraft: {} }),
  'schedule pickup starts draft from English phrase'
);
assert(
  isPickupStatusQuery('فين استلام 123456', { intent: 'pickup' }),
  'pickup status query detected'
);

console.log('\n=== Field extraction ===\n');

{
  const extracted = extractPickupFieldsFromMessage('10', 'numberOfOrders', {}, userContext);
  assert(extracted.numberOfOrders === 10, 'extracts order count');
}

{
  const extracted = extractPickupFieldsFromMessage('بكرة', 'pickupDate', {}, userContext);
  assert(extracted.pickupDate instanceof Date, 'extracts tomorrow date');
}

{
  const today = parsePickupDate('today');
  assert(!validatePickupDate(today), 'today is not valid pickup date');
  const tomorrow = parsePickupDate('tomorrow');
  assert(validatePickupDate(tomorrow), 'tomorrow is valid pickup date');
  const dayAfter = parsePickupDate('after tomorrow');
  assert(validatePickupDate(dayAfter), 'day after tomorrow is valid pickup date');
}

{
  const iso = parsePickupDate('2026-12-25');
  assert(iso instanceof Date && iso.getFullYear() === 2026, 'parses ISO widget date');
}

{
  const extracted = extractPickupFieldsFromMessage('2026-08-15', 'pickupDate', {}, userContext);
  assert(extracted.pickupDate instanceof Date, 'extracts ISO date from message');
}

{
  assert(!validatePickupOrderCount(0), 'rejects zero orders');
  assert(!validatePickupOrderCount(1000), 'rejects over max orders');
  assert(validatePickupOrderCount(37), 'accepts custom order count 37');
}

console.log('\n=== Progress and chips ===\n');

{
  const fields = applyPickupDraftDefaults({}, userData);
  const progress = getPickupDraftProgress(fields, userData);
  assert(progress.collected === 0, 'progress 0/3 at start despite phone default');
  assert(progress.currentField === 'numberOfOrders', 'current field is numberOfOrders');
}

{
  const fields = applyPickupDraftDefaults({}, userData);
  const missing = getPickupClarificationQueue(fields, userData);
  const chips = buildPickupChips(fields, missing, 'en');
  assert(!chips.some((c) => c.key === 'phoneNumber'), 'no phone chip while asking order count');
}

console.log('\n=== Structured field builder ===\n');

{
  const sf = buildPickupStructuredField('numberOfOrders', 'en', userContext, {}, userData);
  assert(sf && sf.type === 'number_presets', 'numberOfOrders structured field type');
  assert(sf.max === 999, 'number max is 999');
}

{
  const sf = buildPickupStructuredField('pickupDate', 'ar', userContext, {}, userData);
  assert(sf && sf.type === 'date_inline', 'pickupDate structured field type');
  assert(sf.minDate === getEarliestPickupDateIso(), 'pickupDate minDate is tomorrow');
  assert(sf.defaultDate === getEarliestPickupDateIso(), 'pickupDate default is tomorrow');
}

console.log('\n=== Draft queue ===\n');

{
  const merged = mergePickupDraft({}, { numberOfOrders: 5 }, 'ar', { userData });
  const queue = getPickupClarificationQueue(merged, userData);
  assert(queue[0] === 'pickupDate', 'after count, asks pickupDate');
}

{
  const tomorrow = parsePickupDate('tomorrow');
  const merged = mergePickupDraft(
    { numberOfOrders: 8 },
    { pickupDate: tomorrow, phoneNumber: '01098765432' },
    'en',
    { userData }
  );
  assert(isPickupDraftComplete(merged, userData), 'complete with defaults');
  const chips = buildPickupChips(merged, [], 'en');
  assert(chips.some((c) => c.key === 'numberOfOrders'), 'chips include order count');
  assert(chips.some((c) => c.key === 'pickupDate'), 'chips include date');
}

console.log('\n=== Draft ready validation ===\n');

{
  const noAddrUser = { phoneNumber: '01012345678', pickUpAddresses: [] };
  const tomorrow = parsePickupDate('tomorrow');
  const fields = { numberOfOrders: 5, pickupDate: tomorrow, phoneNumber: '01098765432' };
  assert(!hasUsablePickupAddress(noAddrUser), 'no address user flagged');
  const incomplete = mergePickupDraft({}, fields, 'en', { userData: noAddrUser });
  assert(!isPickupDraftComplete(incomplete, noAddrUser), 'incomplete without saved address');
  const ready = validatePickupDraftReady(fields, noAddrUser, 'en');
  assert(!ready.ok && ready.needsSettings, 'ready gate fails without address');
}

{
  const emptyAddrUser = {
    phoneNumber: '01012345678',
    pickUpAddresses: [{ addressId: 'x', adressDetails: '', city: '' }],
  };
  const tomorrow = parsePickupDate('tomorrow');
  const fields = { numberOfOrders: 5, pickupDate: tomorrow, phoneNumber: '01098765432' };
  const ready = validatePickupDraftReady(fields, emptyAddrUser, 'en');
  assert(!ready.ok, 'ready gate fails with empty address row');
}

{
  const tomorrow = parsePickupDate('tomorrow');
  const fields = { numberOfOrders: 9, pickupDate: tomorrow, phoneNumber: '01055200152' };
  const ready = validatePickupDraftReady(fields, userData, 'en');
  assert(ready.ok, 'ready gate passes with valid address user');
}

{
  assert(isConfirmPickupPhrase('تأكيد الاستلام'), 'confirm pickup phrase ar');
  assert(isConfirmPickupPhrase('Confirm pickup'), 'confirm pickup phrase en');
}

console.log('\n=== Summary ===\n');
console.log('Passed:', passed, '| Failed:', failed);
process.exit(failed > 0 ? 1 : 0);
