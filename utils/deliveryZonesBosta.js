/**
 * Greater Cairo metro delivery zones (same source as Create order / bosta-regions-data-processed.json).
 */
const crypto = require('node:crypto');
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

const METRO_CATALOG_SCHEMA_VERSION = 1;

/** @param {{ value: string, label?: { en?: string, ar?: string } }} area */
function areaLabelPair(area) {
  const en = (area.label && area.label.en) || area.value;
  const ar = (area.label && area.label.ar) || en;
  return { en, ar };
}

/** @param {{ value?: string, label?: { en?: string, ar?: string } }} gov */
function governorateLabelPair(gov, key) {
  const en = (gov.label && gov.label.en) || gov.value || key;
  const ar = (gov.label && gov.label.ar) || en;
  return { en, ar };
}

function buildMetroDeliveryZonesCatalog() {
  const governorates = [...METRO_GOVERNORATE_KEYS]
    .filter((k) => bostaRegions[k] && Array.isArray(bostaRegions[k].areas))
    .map((key) => {
      const gov = bostaRegions[key];
      const label = governorateLabelPair(gov, key);
      const areas = [...gov.areas]
        .map((a) => ({
          value: a.value,
          label: areaLabelPair(a),
        }))
        .sort((a, b) => (a.label.en || a.value).localeCompare(b.label.en || b.value, 'en'));
      return {
        key,
        value: gov.value || key,
        label,
        areas,
      };
    })
    .sort((a, b) => a.label.en.localeCompare(b.label.en, 'en'));

  return {
    meta: {
      schemaVersion: METRO_CATALOG_SCHEMA_VERSION,
      governorateKeys: [...METRO_GOVERNORATE_KEYS],
    },
    governorates,
  };
}

let metroCatalogCache;
let metroCatalogWeakEtag;

/**
 * Bilingual metro catalog for mobile / API (canonical `key` + `value` strings match order validation).
 * Cached in-process; same data as `bostaRegions` require.
 */
function getMetroDeliveryZonesCatalog() {
  if (!metroCatalogCache) {
    metroCatalogCache = buildMetroDeliveryZonesCatalog();
    const h = crypto.createHash('sha256').update(JSON.stringify(metroCatalogCache)).digest('hex').slice(0, 16);
    metroCatalogWeakEtag = `W/"${h}"`;
  }
  return metroCatalogCache;
}

function getMetroDeliveryZonesCatalogWeakEtag() {
  getMetroDeliveryZonesCatalog();
  return metroCatalogWeakEtag;
}

function getAllValidZoneValuesSet() {
  const set = new Set();
  METRO_GOVERNORATE_KEYS.forEach((key) => {
    const gov = bostaRegions[key];
    if (gov && Array.isArray(gov.areas)) {
      gov.areas.forEach((a) => set.add(a.value));
    }
  });
  return set;
}

/**
 * Filter zone strings to canonical catalog values (case-insensitive fallback).
 * @param {string[]} zones
 * @returns {string[]}
 */
function sanitizeZoneValues(zones) {
  if (!Array.isArray(zones)) return [];
  const valid = getAllValidZoneValuesSet();
  const lowerMap = new Map();
  valid.forEach((v) => lowerMap.set(v.toLowerCase(), v));
  const out = [];
  const seen = new Set();
  zones.forEach((z) => {
    const raw = String(z || '').trim();
    if (!raw || seen.has(raw)) return;
    if (valid.has(raw)) {
      seen.add(raw);
      out.push(raw);
      return;
    }
    const canonical = lowerMap.get(raw.toLowerCase());
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  });
  return out;
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
  getMetroDeliveryZonesCatalog,
  getMetroDeliveryZonesCatalogWeakEtag,
  sanitizeZoneValues,
};
