/**
 * Greater Cairo metro delivery zones (same source as Create order / bosta-regions-data-processed.json).
 */
const path = require('path');
const bostaRegions = require(path.join(
  __dirname,
  '../public/assets/js/bosta-regions-data-processed.json'
));

/** Top-level keys in bosta-regions-data-processed.json for fee metro + Bosta zones */
const METRO_GOVERNORATE_KEYS = Object.freeze(['Cairo', 'Giza', 'Qalyubia']);

/** Input string → canonical key in bostaRegions (case-insensitive + Bosta alias for Qalyubia). */
const GOVERNORATE_INPUT_ALIASES = new Map([
  ['elkalioubia', 'Qalyubia'],
  ['kalioubia', 'Qalyubia'],
  ['qalyoubia', 'Qalyubia'],
  ['qalyubia', 'Qalyubia'],
  ['alqalyubia', 'Qalyubia'],
  ['cairo', 'Cairo'],
  ['giza', 'Giza'],
]);

function compactGovKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function normalizeGovKey(input) {
  if (input == null || String(input).trim() === '') return null;
  const t = String(input).trim();
  const lower = t.toLowerCase();
  const compact = compactGovKey(t);
  const alias = GOVERNORATE_INPUT_ALIASES.get(compact);
  if (alias) return alias;

  for (const key of Object.keys(bostaRegions)) {
    if (key.toLowerCase() === lower) return key;
    const gov = bostaRegions[key];
    if (gov.label && gov.label.en && gov.label.en.toLowerCase() === lower) return key;
  }
  return null;
}

/**
 * Returns canonical zone `value` from Bosta data if it matches (exact, then case-insensitive).
 */
function resolveZoneForGovernorate(governmentKey, zoneInput) {
  if (!governmentKey || zoneInput == null) return null;
  const gov = bostaRegions[governmentKey];
  if (!gov || !Array.isArray(gov.areas)) return null;
  const raw = String(zoneInput).trim();
  if (!raw) return null;

  const exact = gov.areas.find((a) => a.value === raw);
  if (exact) return exact.value;

  const lower = raw.toLowerCase();
  const ci = gov.areas.find((a) => a.value.toLowerCase() === lower);
  return ci ? ci.value : null;
}

/**
 * @returns {{ ok: boolean, error?: string, canonicalGovernment?: string, canonicalZone?: string }}
 */
function validateGovernmentAndZone(government, zone) {
  const govKey = normalizeGovKey(government);
  if (!govKey || !METRO_GOVERNORATE_KEYS.includes(govKey)) {
    return {
      ok: false,
      error: `Governorate must be one of: ${METRO_GOVERNORATE_KEYS.join(', ')} (got "${government}").`,
    };
  }

  const canonicalZone = resolveZoneForGovernorate(govKey, zone);
  if (!canonicalZone) {
    return {
      ok: false,
      error: `Area / zone "${zone}" is not valid for ${govKey}. Use the same zone as Create order.`,
    };
  }

  return {
    ok: true,
    canonicalGovernment: govKey,
    canonicalZone,
  };
}

function getGovernorateNamesSorted() {
  return [...METRO_GOVERNORATE_KEYS].filter((k) => bostaRegions[k]).sort((a, b) => a.localeCompare(b));
}

/** Zone values for a metro governorate (Bosta English `value`). */
function getZoneValuesForGovernorate(governmentKey) {
  const key = normalizeGovKey(governmentKey);
  if (!key || !bostaRegions[key] || !bostaRegions[key].areas) return [];
  return bostaRegions[key].areas.map((a) => a.value);
}

/** Cairo-only zone values (backward compat; same as Create order for Cairo). */
function getCairoZoneValues() {
  return getZoneValuesForGovernorate('Cairo');
}

module.exports = {
  METRO_GOVERNORATE_KEYS,
  bostaRegions,
  normalizeGovKey,
  resolveZoneForGovernorate,
  validateGovernmentAndZone,
  getGovernorateNamesSorted,
  getZoneValuesForGovernorate,
  getCairoZoneValues,
};
