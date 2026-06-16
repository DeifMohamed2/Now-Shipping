#!/usr/bin/env node
/**
 * Regression tests for AINOW context parsing (address/zone reconciliation).
 * Run: node scripts/test-ainow-context-draft.js
 */
const {
  sanitizeAddressText,
  detectAddressZoneConflict,
  reconcileDraftContext,
} = require('../services/ai/draftContextEngine');
const { applyRegionResolution } = require('../services/ai/regionResolver');
const { shouldAnswerOrderDraftServerSide, resolveConversationLang } = require('../services/ai/assistantOrchestrator');
const { normalizeDraftFields } = require('../services/ai/textNormalizer');

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

function run() {
  console.log('=== sanitizeAddressText ===\n');

  const cleaned = sanitizeAddressText('العنوان بالتفصيل ١٢ شارع النيل', 'ar');
  assert(!cleaned.includes('العنوان بالتفصيل'), 'strips العنوان بالتفصيل prefix');
  assert(cleaned.includes('شارع النيل'), 'keeps street content');

  const cleaned2 = sanitizeAddressText('العنوان بالتفصيل واحد ميدان الاوبرا للشارع المرغني', 'ar');
  assert(!cleaned2.startsWith('العنوان'), 'strips leading العنوان meta');
  assert(/اوبرا|اوبيرا/i.test(cleaned2), 'preserves opera landmark in address');

  console.log('\n=== Opera address vs Maadi zone conflict ===\n');

  const maadiDraft = {
    orderType: 'Deliver',
    fullName: 'ضيف محمد',
    phoneNumber: '01156012078',
    government: 'Cairo',
    zone: 'ElMaadi',
    address: 'واحد ميدان الاوبرا للشارع المرغني',
  };

  assert(detectAddressZoneConflict(maadiDraft), 'detects opera vs maadi conflict');

  const { fields: reconciled, hints } = reconcileDraftContext(maadiDraft, { lang: 'ar' });
  assert(hints.zoneCorrectedFromAddress, 'reconcile flags zone correction');
  assert(!reconciled.zone, 'zone cleared after conflict');
  assert(reconciled.zoneQuery, 'zoneQuery set from address landmark');

  const { fields: resolved, regionHints } = applyRegionResolution(
    { ...maadiDraft },
    { splitAddress: true, lang: 'ar' }
  );
  const zoneNorm = (resolved.zone || '').toLowerCase();
  assert(
    zoneNorm.includes('abdeen') || zoneNorm.includes('downtown') || regionHints.zoneSuggestions?.length,
    'opera address re-resolves away from Maadi'
  );
  assert(
    !resolved.address?.includes('العنوان بالتفصيل'),
    'resolved address has no meta filler'
  );

  const fullScenario = {
    ...maadiDraft,
    address: 'العنوان بالتفصيل واحد ميدان الاوبرا للشارع المرغني',
  };
  const normalized = normalizeDraftFields(
    applyRegionResolution(fullScenario, { splitAddress: true, lang: 'ar' }).fields,
    'ar'
  );
  assert(!normalized.address?.includes('العنوان بالتفصيل'), 'normalize pipeline strips address filler');

  console.log('\n=== Maadi address with Maadi zone — no conflict ===\n');

  const consistent = {
    government: 'Cairo',
    zone: 'ElMaadi',
    address: '١٢ شارع ٩ المعادي',
  };
  assert(!detectAddressZoneConflict(consistent), 'no conflict when address matches maadi zone');

  const { fields: kept } = applyRegionResolution({ ...consistent }, { splitAddress: true, lang: 'ar' });
  assert(kept.zone === 'ElMaadi', 'maadi zone unchanged when consistent');

  console.log('\n=== shouldAnswerOrderDraftServerSide routing ===\n');

  const orderDraft = {
    activeDraft: {
      type: 'order',
      fields: { fullName: 'Test', government: 'Cairo', zone: 'ElMaadi' },
      pendingField: 'address',
      regionOptions: [],
    },
  };
  assert(
    !shouldAnswerOrderDraftServerSide(orderDraft, 'واحد ميدان الاوبرا'),
    'address pending uses Gemini path'
  );

  orderDraft.activeDraft.pendingField = 'productDescription';
  assert(
    shouldAnswerOrderDraftServerSide(orderDraft, 'تيشرتين'),
    'product description uses server path (voice-friendly)'
  );

  orderDraft.activeDraft.pendingField = 'phoneNumber';
  assert(
    shouldAnswerOrderDraftServerSide(orderDraft, '01156012078'),
    'phone pending uses server path'
  );

  orderDraft.activeDraft.pendingField = 'address';
  assert(
    !shouldAnswerOrderDraftServerSide(orderDraft, 'واحد ميدان الاوبرا'),
    'opera message with maadi draft routes to Gemini via conflict detect'
  );

  console.log('\n=== resolveConversationLang ===\n');

  const arConversation = {
    activeDraft: {
      fields: { fullName: 'ضيف محمد', address: '١ شارع المعادي' },
      pendingField: 'productDescription',
    },
    messages: [],
  };
  assert(
    resolveConversationLang(arConversation, 'en') === 'ar',
    'Arabic draft fields override English UI preference'
  );

  console.log('\n=== Done ===');
  console.log('Passed:', passed, '| Failed:', failed);
  process.exit(failed > 0 ? 1 : 0);
}

run();
