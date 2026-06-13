const {
  resolveZoneQuery,
  normalizeArabicDigitsToLatin,
  normalizeText,
  getZoneLabel,
  isValidGovernmentAndZone,
} = require('../../utils/bostaRegionsServer');
const { ZONE_LANDMARK_BOOSTS } = require('../../utils/zoneMatchUtils');

const LANDMARK_ZONE_HINTS = [
  { pattern: /اوبيرا|اوبرا|opera/i, zoneValue: 'Abdeen - Downtown Cairo' },
  { pattern: /العتبه|elataba/i, zoneValue: 'Abdeen - ElAtaba' },
  { pattern: /باب اللوق|bab ellouq/i, zoneValue: 'Abdeen - Bab ElLouq' },
  { pattern: /وسط البلد|downtown cairo/i, zoneValue: 'Abdeen - Downtown Cairo' },
];

/**
 * Split a user address reply into street (address) and area (zoneQuery).
 */
function splitAddressAndZoneFromText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { address: null, zoneQuery: null };

  let working = trimmed
    .replace(/(?:،|,)\s*(?:القاهره|القاهرة|cairo)\s*$/i, '')
    .replace(/\s+(?:القاهره|القاهرة|cairo)\s*$/i, '')
    .trim();

  const commaParts = working.split(/[،,]/).map((s) => s.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const lastPart = commaParts[commaParts.length - 1];
    const resolved = resolveZoneQuery(lastPart);
    if (resolved.match || resolved.needsUserPick) {
      return {
        address: commaParts.slice(0, -1).join('، ') || trimmed,
        zoneQuery: lastPart,
      };
    }
  }

  const words = working.split(/\s+/);
  let bestSplit = null;
  for (let len = 1; len <= Math.min(4, words.length - 1); len++) {
    const candidate = words.slice(-len).join(' ');
    const resolved = resolveZoneQuery(candidate);
    if ((resolved.match || resolved.needsUserPick) && len < words.length) {
      const street = words.slice(0, -len).join(' ').trim();
      if (street.length >= 5 && (!bestSplit || street.length > bestSplit.address.length)) {
        bestSplit = { address: street, zoneQuery: candidate };
      }
    }
  }
  if (bestSplit) return bestSplit;

  const fullResolved = resolveZoneQuery(working);
  if ((fullResolved.match || fullResolved.needsUserPick) && working.length < 30) {
    return { address: null, zoneQuery: working };
  }

  return { address: trimmed, zoneQuery: null };
}

function pickPreferredAmbiguousZone(options, fields) {
  if (!options || !options.length) return null;
  const haystack = normalizeText(
    `${fields.address || ''} ${fields.zoneQuery || ''}`
  );

  for (const hint of LANDMARK_ZONE_HINTS) {
    if (hint.pattern.test(haystack)) {
      const match = options.find((o) => o.zone === hint.zoneValue);
      if (match) return match;
    }
  }

  if (options.length === 1) return options[0];
  return null;
}

function mergeLandmarkQuery(fields) {
  const haystack = normalizeText(
    `${fields.address || ''} ${fields.zoneQuery || ''}`
  );
  for (const hint of ZONE_LANDMARK_BOOSTS) {
    if (hint.pattern.test(haystack) && !fields.zoneQuery) {
      return { ...fields, zoneQuery: haystack.match(hint.pattern)[0] };
    }
  }
  return fields;
}

function invalidateZoneFields(next, regionHints) {
  const rawZone = next.zone || next.zoneQuery || '';
  if (rawZone && !next.zoneQuery) {
    next.zoneQuery = String(rawZone);
  }
  delete next.government;
  delete next.zone;
  regionHints.invalidZone = rawZone;
}

function applyResolvedZone(next, match, regionHints) {
  next.government = match.government;
  next.zone = match.zone;
  delete next.zoneQuery;
  regionHints.confirmed = { government: match.government, zone: match.zone };
  if (match.confidence) {
    regionHints.zoneConfidence = match.confidence;
  }
}

function applyZoneSuggestions(regionHints, resolved, reason) {
  const list = resolved.suggestions || resolved.options || [];
  if (!list.length) return;
  let pickReason = reason;
  const topScore = list[0]?.score || 0;
  if (pickReason === 'ambiguous' && topScore < 70) {
    pickReason = 'no_match';
  }
  regionHints.zoneSuggestions = list;
  regionHints.zonePickReason = pickReason;
  regionHints.ambiguousOptions = list;
}

/**
 * Apply region resolution to extracted fields from Gemini.
 * @param {object} fields
 * @param {object} [opts]
 * @returns {{ fields: object, regionHints: object }}
 */
function applyRegionResolution(fields, opts) {
  let next = { ...fields };
  const regionHints = {};

  if (next.phoneNumber) {
    next.phoneNumber = normalizeArabicDigitsToLatin(String(next.phoneNumber)).replace(/\D/g, '');
    if (next.phoneNumber.startsWith('20') && next.phoneNumber.length > 11) {
      next.phoneNumber = '0' + next.phoneNumber.slice(2);
    }
  }
  if (next.otherPhoneNumber) {
    next.otherPhoneNumber = normalizeArabicDigitsToLatin(String(next.otherPhoneNumber)).replace(/\D/g, '');
  }

  next = mergeLandmarkQuery(next);

  if (opts?.splitAddress && next.address && !next.zoneQuery && (!next.government || !next.zone)) {
    const split = splitAddressAndZoneFromText(next.address);
    if (split.zoneQuery) {
      next.zoneQuery = split.zoneQuery;
      if (split.address) next.address = split.address;
    }
  }

  if (next.government && next.zone) {
    const valid = isValidGovernmentAndZone(next.government, next.zone);
    if (valid.ok) {
      next.government = valid.government;
      next.zone = valid.zone;
      regionHints.confirmed = { government: next.government, zone: next.zone };
    } else {
      invalidateZoneFields(next, regionHints);
    }
  } else if (next.government && !next.zone) {
    delete next.government;
  } else if (!next.government && next.zone) {
    next.zoneQuery = next.zoneQuery || String(next.zone);
    delete next.zone;
  }

  const zoneQuery = next.zoneQuery || null;
  if (zoneQuery && (!next.government || !next.zone)) {
    const resolved = resolveZoneQuery(zoneQuery);
    regionHints.resolved = resolved;

    if (resolved.match && !resolved.needsUserPick) {
      applyResolvedZone(next, resolved.match, regionHints);
    } else if (resolved.needsUserPick && (resolved.suggestions || resolved.options || []).length) {
      const options = resolved.suggestions || resolved.options;
      const preferred = pickPreferredAmbiguousZone(options, next);
      if (preferred && options.length === 1) {
        applyResolvedZone(next, preferred, regionHints);
      } else {
        const reason = regionHints.invalidZone ? 'invalid' : 'ambiguous';
        applyZoneSuggestions(regionHints, resolved, reason);
      }
    } else if (regionHints.invalidZone) {
      const similar = resolveZoneQuery(zoneQuery);
      applyZoneSuggestions(regionHints, similar, 'invalid');
    }
  } else if (next.government && next.zone && !regionHints.confirmed) {
    const valid = isValidGovernmentAndZone(next.government, next.zone);
    if (valid.ok) {
      regionHints.confirmed = { government: valid.government, zone: valid.zone };
    }
  }

  return { fields: next, regionHints };
}

function formatZoneForDisplay(government, zone, lang) {
  return getZoneLabel(government, zone, lang);
}

module.exports = {
  applyRegionResolution,
  formatZoneForDisplay,
  resolveZoneQuery,
  splitAddressAndZoneFromText,
  pickPreferredAmbiguousZone,
  isValidGovernmentAndZone,
};
