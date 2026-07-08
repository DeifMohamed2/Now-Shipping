const { normalizeText } = require('../../utils/bostaRegionsServer');
const { ZONE_LANDMARK_BOOSTS } = require('../../utils/zoneMatchUtils');

const ADDRESS_META_PREFIXES = [
  /^العنوان\s+بالتفصيل\s*/i,
  /^العنوان\s+هو\s*/i,
  /^العنوان\s*[:：]\s*/i,
  /^العنوان\s+/i,
  /^address\s+is\s*/i,
  /^address\s*[:：]\s*/i,
  /^the\s+address\s+is\s*/i,
];

/**
 * Strip conversational wrappers from address text; normalize leading number words.
 */
function sanitizeAddressText(text, lang) {
  if (!text || typeof text !== 'string') return text;
  let cleaned = text.trim();
  for (const re of ADDRESS_META_PREFIXES) {
    cleaned = cleaned.replace(re, '');
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || text.trim();
}

/**
 * Find strongest landmark/area signal in text using shared ZONE_LANDMARK_BOOSTS.
 * @returns {{ government: string, zone: string, matchText: string, boost: number } | null}
 */
function extractLandmarkSignals(text) {
  const haystack = normalizeText(String(text || ''));
  if (!haystack) return null;

  let best = null;
  for (const hint of ZONE_LANDMARK_BOOSTS) {
    const m = haystack.match(hint.pattern);
    if (m && (!best || hint.boost > best.boost)) {
      best = {
        government: hint.government,
        zone: hint.zone,
        matchText: m[0],
        boost: hint.boost,
      };
    }
  }
  return best;
}

function getLandmarkBoostForZone(text, government, zone) {
  const haystack = normalizeText(String(text || ''));
  let boost = 0;
  for (const hint of ZONE_LANDMARK_BOOSTS) {
    if (
      hint.pattern.test(haystack) &&
      hint.government === government &&
      hint.zone === zone
    ) {
      boost = Math.max(boost, hint.boost);
    }
  }
  return boost;
}

/**
 * Detect when address text implies a different zone than the locked draft zone.
 */
function detectAddressZoneConflict(fields) {
  if (!fields?.government || !fields?.zone || !fields?.address) return null;

  const signal = extractLandmarkSignals(fields.address);
  if (!signal) return null;

  const currentZoneNorm = normalizeText(fields.zone);
  const signalZoneNorm = normalizeText(signal.zone);

  if (currentZoneNorm === signalZoneNorm) return null;
  if (currentZoneNorm.includes(signalZoneNorm) || signalZoneNorm.includes(currentZoneNorm)) {
    return null;
  }

  const currentBoost = getLandmarkBoostForZone(fields.address, fields.government, fields.zone);
  if (currentBoost >= signal.boost) return null;

  return {
    currentZone: fields.zone,
    currentGovernment: fields.government,
    suggestedGovernment: signal.government,
    suggestedZone: signal.zone,
    signalText: signal.matchText,
  };
}

/**
 * Detect conflict from incoming message + current draft (before merge).
 */
function detectMessageZoneConflict(message, draftFields) {
  if (!message || !draftFields?.government || !draftFields?.zone) return null;
  return detectAddressZoneConflict({
    ...draftFields,
    address: String(message).trim(),
  });
}

function invalidateZoneForReconcile(next, regionHints, previousZone) {
  const rawZone = previousZone || next.zone || next.zoneQuery || '';
  if (rawZone && !next.zoneQuery) {
    next.zoneQuery = String(rawZone);
  }
  delete next.government;
  delete next.zone;
  regionHints.invalidZone = rawZone;
}

/**
 * Reconcile address/zone context: sanitize address, invalidate stale zone when address contradicts.
 */
function reconcileDraftContext(fields, opts = {}) {
  const lang = opts.lang || 'ar';
  const regionHints = { ...(opts.regionHints || {}) };
  const next = { ...fields };
  const replaceZone = opts.replaceZone === true;
  const trustUserZone = opts.trustUserZone === true;

  if (next.address) {
    next.address = sanitizeAddressText(next.address, lang);
  }

  const conflict =
    trustUserZone
      ? null
      : replaceZone && next.government && next.zone
        ? { currentZone: next.zone, signalText: null }
        : detectAddressZoneConflict(next);

  if (conflict && next.government && next.zone) {
    const previousZone = next.zone;
    const signal = extractLandmarkSignals(next.address) || extractLandmarkSignals(next.zoneQuery);
    invalidateZoneForReconcile(next, regionHints, previousZone);
    if (signal) {
      next.zoneQuery = signal.matchText;
    }
    regionHints.zoneCorrectedFromAddress = true;
    regionHints.previousZone = previousZone;
    if (signal) {
      regionHints.suggestedZone = { government: signal.government, zone: signal.zone };
    }
  }

  if (!next.zoneQuery && next.address) {
    const signal = extractLandmarkSignals(next.address);
    if (signal && (!next.government || !next.zone)) {
      next.zoneQuery = signal.matchText;
    }
  }

  return { fields: next, hints: regionHints };
}

module.exports = {
  sanitizeAddressText,
  extractLandmarkSignals,
  detectAddressZoneConflict,
  detectMessageZoneConflict,
  reconcileDraftContext,
};
