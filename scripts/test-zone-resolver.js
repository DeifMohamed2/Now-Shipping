#!/usr/bin/env node
/**
 * Regression tests for AINOW zone resolution.
 * Run: node scripts/test-zone-resolver.js
 */
const { resolveZoneQuery } = require('../utils/bostaRegionsServer');
const { applyRegionResolution } = require('../services/ai/regionResolver');

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

console.log('=== resolveZoneQuery ===\n');

console.log('عابدين — parent should not auto-accept');
{
  const r = resolveZoneQuery('عابدين');
  assert(!r.match, 'no auto match');
  assert(r.needsUserPick, 'needs user pick');
  assert(r.suggestions.length >= 2, 'has sub-zone suggestions');
  assert(
    r.suggestions.some((s) => String(s.zone).includes('Abdeen -')),
    'includes Abdeen sub-zones'
  );
}

console.log('\nاوبيرا — landmark suggests Downtown Cairo in top 3');
{
  const r = resolveZoneQuery('اوبيرا');
  const top3 = r.suggestions.slice(0, 3).map((s) => s.zone);
  assert(
    top3.includes('Abdeen - Downtown Cairo'),
    'Abdeen - Downtown Cairo in top 3 (got: ' + top3.join(', ') + ')'
  );
}

console.log('\nمعادي — multiple options, never empty');
{
  const r = resolveZoneQuery('معادي');
  assert(r.suggestions.length >= 3, 'at least 3 suggestions');
  assert(r.needsUserPick, 'needs user pick');
}

console.log('\nxyzunknown — suggestions non-empty, no auto-match');
{
  const r = resolveZoneQuery('xyzunknown');
  assert(!r.match, 'no auto match');
  assert(r.suggestions.length >= 1, 'has fallback suggestions');
}

console.log('\n=== applyRegionResolution ===\n');

console.log('Invalid Gemini zone — invalidated + suggestions');
{
  const { fields, regionHints } = applyRegionResolution(
    {
      fullName: 'Test',
      government: 'Cairo',
      zone: 'FakeZoneThatDoesNotExist',
    },
    { splitAddress: false }
  );
  assert(!fields.zone, 'zone cleared');
  assert(!fields.government, 'government cleared');
  assert(regionHints.invalidZone, 'invalidZone flagged');
  assert(
    (regionHints.zoneSuggestions || []).length >= 1,
    'zone suggestions provided'
  );
}

console.log('\nValid zone pair — accepted');
{
  const { fields, regionHints } = applyRegionResolution(
    {
      government: 'Cairo',
      zone: 'Abdeen',
    },
    { splitAddress: false }
  );
  assert(fields.zone === 'Abdeen', 'zone accepted');
  assert(fields.government === 'Cairo', 'government accepted');
  assert(regionHints.confirmed, 'confirmed hint');
}

console.log('\n---');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
