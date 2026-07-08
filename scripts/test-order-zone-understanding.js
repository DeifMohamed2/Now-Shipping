#!/usr/bin/env node
/**
 * Zone/address understanding regression tests (AINOW order pipeline).
 * Run: node scripts/test-order-zone-understanding.js
 */
const {
  splitAddressAndZoneFromText,
  applyRegionResolution,
} = require('../services/ai/regionResolver');
const { getClarificationQueue } = require('../services/ai/orderDraftService');
const { resolveZoneQuery } = require('../utils/bostaRegionsServer');

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

const FULL_ADDRESS = '1 medan opera abdeen cairo with buldion number 1';

console.log('=== Full-address landmark split ===\n');

{
  const split = splitAddressAndZoneFromText(FULL_ADDRESS);
  assert(split.zoneQuery !== '1', 'zoneQuery is not bare "1"');
  assert(/opera|abdeen|اوبيرا/i.test(String(split.zoneQuery || '')), 'zoneQuery matches opera/abdeen landmark');
  assert(split.address && split.address.includes('medan'), 'address retains medan');
  assert(split.address && /buldion|number/i.test(split.address), 'address retains building detail');
}

console.log('\n=== applyRegionResolution on full address ===\n');

{
  const { fields, regionHints } = applyRegionResolution(
    { address: FULL_ADDRESS },
    { splitAddress: true, lang: 'en' }
  );
  assert(fields.zoneQuery !== '1', 'resolved fields never have zoneQuery "1"');
  assert(
    fields.zone === 'Abdeen - Downtown Cairo' ||
      (regionHints.zoneSuggestions && regionHints.zoneSuggestions.length > 0),
    'auto-resolves Abdeen Downtown or yields zone suggestions'
  );
  assert(fields.address && fields.address.includes('buldion'), 'full address detail preserved');
}

console.log('\n=== Zone-picker gate (clarification queue) ===\n');

{
  const draft = {
    orderType: 'Deliver',
    fullName: 'Deif Mohamed ahmed',
    phoneNumber: '01156012078',
    address: '1 medan',
    zoneQuery: 'abdeen',
  };
  const queue = getClarificationQueue(draft, {});
  assert(queue[0] === 'zone', 'clarification queue leads with zone when area unset');
}

{
  const resolved = resolveZoneQuery('abdeen');
  assert(resolved.needsUserPick && (resolved.suggestions || []).length > 0, 'abdeen yields zone suggestions');
}

{
  const resolved = resolveZoneQuery('Maadi');
  assert(resolved.needsUserPick && (resolved.suggestions || []).length > 0, 'Maadi yields zone suggestions');
  const zones = (resolved.suggestions || []).map((s) => s.zone);
  assert(zones.some((z) => /Maadi/i.test(z)), 'Maadi suggestions include ElMaadi');
}

{
  const resolved = resolveZoneQuery('المعادي - دجله');
  assert(resolved.match && resolved.match.zone === 'ElMaadi - Degla', 'exact sub-zone auto-resolves Degla');
  assert(!resolved.needsUserPick, 'Degla does not re-prompt zone picker');
}

console.log('\n=== Invalid tail candidates rejected ===\n');

{
  const split = splitAddressAndZoneFromText('12 Tahrir Street building 5');
  assert(split.zoneQuery !== '5' && split.zoneQuery !== '1', 'building number not used as zone');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
