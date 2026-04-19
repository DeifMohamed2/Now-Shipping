/**
 * Cairo-only delivery zones (same source as Create order / bosta-regions-data-processed.json).
 */
const path = require('path');
const bostaRegions = require(path.join(
  __dirname,
  '../public/assets/js/bosta-regions-data-processed.json'
));

function normalizeGovKey(input) {
  if (input == null || String(input).trim() === '') return null;
  const t = String(input).trim();
  const lower = t.toLowerCase();
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
  if (!govKey) {
    return {
      ok: false,
      error: `Governorate must be Cairo (got "${government}").`,
    };
  }

  const canonicalZone = resolveZoneForGovernorate(govKey, zone);
  if (!canonicalZone) {
    return {
      ok: false,
      error: `Area / zone "${zone}" is not valid. Use the same zone as Create order.`,
    };
  }

  return {
    ok: true,
    canonicalGovernment: govKey,
    canonicalZone,
  };
}

function getGovernorateNamesSorted() {
  return Object.keys(bostaRegions).sort((a, b) => a.localeCompare(b));
}

/** Cairo-only zone values (same list as area-selection modal for Cairo). */
function getCairoZoneValues() {
  const cairo = bostaRegions.Cairo;
  if (!cairo || !cairo.areas) return [];
  return cairo.areas.map((a) => a.value);
}

module.exports = {
  bostaRegions,
  normalizeGovKey,
  resolveZoneForGovernorate,
  validateGovernmentAndZone,
  getGovernorateNamesSorted,
  getCairoZoneValues,
};
