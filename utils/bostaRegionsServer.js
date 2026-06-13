/**
 * Server-side index for Bosta Egypt regions (government + zone lookup).
 */
const path = require('path');
const fs = require('fs');
const { validateGovernmentAndZone } = require('./deliveryZonesBosta');
const {
  scoreZoneEntry,
  shouldForceParentDisambiguation,
  canAutoAccept,
  toSuggestion,
  levenshteinRatio,
} = require('./zoneMatchUtils');

let regionsData = null;
let zoneIndex = null;

const SUGGESTION_LIMIT = 8;
const AUTO_ACCEPT_MIN_SCORE = 92;
const AUTO_ACCEPT_MIN_GAP = 12;

function loadRegionsData() {
  if (regionsData) return regionsData;
  const filePath = path.join(__dirname, '../public/assets/js/bosta-regions-data-processed.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  regionsData = JSON.parse(raw);
  return regionsData;
}

function normalizeText(s) {
  if (!s) return '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}

function normalizeArabicDigitsToLatin(s) {
  if (!s) return '';
  const map = {
    '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
    '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
    '\u06f0': '0', '\u06f1': '1', '\u06f2': '2', '\u06f3': '3', '\u06f4': '4',
    '\u06f5': '5', '\u06f6': '6', '\u06f7': '7', '\u06f8': '8', '\u06f9': '9',
  };
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += map[ch] !== undefined ? map[ch] : ch;
  }
  return out;
}

function normalizeLabel(s) {
  return normalizeText(normalizeArabicDigitsToLatin(s));
}

function buildZoneIndex() {
  if (zoneIndex) return zoneIndex;
  const data = loadRegionsData();
  const entries = [];

  for (const govKey of Object.keys(data)) {
    const gov = data[govKey];
    const areas = Array.isArray(gov.areas) ? gov.areas : [];
    for (const area of areas) {
      entries.push({
        government: govKey,
        zone: area.value,
        labels: [
          area.label && area.label.en,
          area.label && area.label.ar,
          area.value,
        ].filter(Boolean),
      });
    }
  }

  zoneIndex = entries;
  return zoneIndex;
}

function enrichScoredRow(entry, score, reason, matchedLabel) {
  const data = loadRegionsData();
  const gov = data[entry.government];
  const area = gov.areas.find((a) => a.value === entry.zone);
  return {
    government: entry.government,
    zone: entry.zone,
    labelAr: area && area.label ? area.label.ar : entry.zone,
    labelEn: area && area.label ? area.label.en : entry.zone,
    score,
    reason,
    matchedLabel,
  };
}

/**
 * Score all catalog zones against a normalized query.
 */
function scoreAllZones(queryNorm) {
  const index = buildZoneIndex();
  const scored = [];

  for (const entry of index) {
    const { score, reason, matchedLabel } = scoreZoneEntry(queryNorm, entry, normalizeLabel);
    if (score > 0) {
      scored.push(enrichScoredRow(entry, score, reason, matchedLabel));
    }
  }

  if (scored.length === 0 && queryNorm.length >= 2) {
    for (const entry of index) {
      let bestLev = 0;
      let bestLabel = entry.zone;
      for (const label of entry.labels) {
        const lev = levenshteinRatio(queryNorm, normalizeLabel(label));
        if (lev > bestLev) {
          bestLev = lev;
          bestLabel = label;
        }
      }
      if (bestLev > 0) {
        const score = Math.max(15, Math.round(bestLev * 70));
        scored.push(enrichScoredRow(entry, score, 'phonetic', bestLabel));
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function findSimilarZones(query, limit = SUGGESTION_LIMIT) {
  const queryNorm = normalizeLabel(query);
  if (!queryNorm) return [];
  return scoreAllZones(queryNorm).slice(0, limit).map(toSuggestion);
}

function isValidGovernmentAndZone(government, zone) {
  const result = validateGovernmentAndZone(government, zone);
  return result.ok
    ? {
        ok: true,
        government: result.canonicalGovernment,
        zone: result.canonicalZone,
      }
    : { ok: false, error: result.error };
}

/**
 * Resolve a free-text zone/area query to canonical government + zone.
 */
function resolveZoneQuery(query) {
  const empty = {
    match: null,
    suggestions: [],
    needsUserPick: false,
    queryNorm: '',
    options: [],
    ambiguous: false,
  };

  if (!query || !String(query).trim()) {
    return empty;
  }

  const queryNorm = normalizeLabel(query);
  const scored = scoreAllZones(queryNorm);
  const top = scored.slice(0, SUGGESTION_LIMIT);
  const suggestions = top.map(toSuggestion);

  if (top.length === 0) {
    return { ...empty, queryNorm, needsUserPick: false };
  }

  const best = top[0];
  const second = top[1] || null;
  const forceParentPick = shouldForceParentDisambiguation(best, scored);
  const autoAccept = !forceParentPick && canAutoAccept(best, second);

  if (autoAccept) {
    const confidence = best.score >= 98 || best.reason === 'exact' ? 'high' : 'medium';
    const match = {
      government: best.government,
      zone: best.zone,
      labelAr: best.labelAr,
      labelEn: best.labelEn,
      confidence,
    };
    return {
      match,
      suggestions,
      needsUserPick: false,
      queryNorm,
      options: suggestions,
      ambiguous: false,
    };
  }

  const close = top.filter((t) => t.score >= best.score - 8);
  const pickList = (close.length > 1 ? close : top).slice(0, 6).map(toSuggestion);
  const finalSuggestions = pickList.length ? pickList : suggestions;

  return {
    match: null,
    suggestions: finalSuggestions,
    needsUserPick: finalSuggestions.length > 0,
    queryNorm,
    options: finalSuggestions,
    ambiguous: finalSuggestions.length > 0,
  };
}

function getZoneLabel(government, zone, lang) {
  const data = loadRegionsData();
  const gov = data[government];
  if (!gov) return zone;
  const area = (gov.areas || []).find((a) => a.value === zone);
  if (!area || !area.label) return zone;
  return lang === 'ar' ? area.label.ar || area.label.en : area.label.en || area.label.ar;
}

/** @deprecated use scoreLabelPair from zoneMatchUtils — kept for tests */
function scoreMatch(queryNorm, labelNorm) {
  const { scoreLabelPair } = require('./zoneMatchUtils');
  return scoreLabelPair(queryNorm, labelNorm).score;
}

module.exports = {
  loadRegionsData,
  normalizeArabicDigitsToLatin,
  normalizeText,
  normalizeLabel,
  resolveZoneQuery,
  findSimilarZones,
  isValidGovernmentAndZone,
  scoreAllZones,
  getZoneLabel,
  scoreMatch,
  AUTO_ACCEPT_MIN_SCORE,
  AUTO_ACCEPT_MIN_GAP,
};
