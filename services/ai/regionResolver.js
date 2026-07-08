const {
  resolveZoneQuery,
  normalizeArabicDigitsToLatin,
  normalizeText,
  getZoneLabel,
  isValidGovernmentAndZone,
} = require('../../utils/bostaRegionsServer');
const { ZONE_LANDMARK_BOOSTS } = require('../../utils/zoneMatchUtils');
const { reconcileDraftContext, extractLandmarkSignals } = require('./draftContextEngine');

const LANDMARK_ZONE_HINTS = [
  { pattern: /اوبيرا|اوبرا|opera/i, zoneValue: 'Abdeen - Downtown Cairo' },
  { pattern: /العتبه|elataba/i, zoneValue: 'Abdeen - ElAtaba' },
  { pattern: /باب اللوق|bab ellouq/i, zoneValue: 'Abdeen - Bab ElLouq' },
  { pattern: /وسط البلد|downtown cairo/i, zoneValue: 'Abdeen - Downtown Cairo' },
];

const ZONE_TAIL_STOPWORDS = /^(?:with|and|the|in|at|cairo|القاهرة|القاهره|number|no|building|bld|buldion|بناية|مبنى)$/i;

/**
 * Reject bare numbers, stopwords, and building-number tails as zone candidates.
 */
function isValidZoneTailCandidate(candidate) {
  const c = String(candidate || '').trim();
  if (!c || c.length < 2) return false;
  if (/^\d+$/.test(c)) return false;
  if (/^(?:number|no|building|bld|buldion|بناية|مبنى)\s*\d*$/i.test(c)) return false;

  const words = c.split(/\s+/).filter(Boolean);
  if (words.every((w) => ZONE_TAIL_STOPWORDS.test(w) || /^\d+$/.test(w))) return false;

  return words.some((w) => w.length >= 3 && !/^\d+$/.test(w));
}

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

  const landmark = extractLandmarkSignals(working);
  if (landmark && landmark.matchText) {
    return {
      address: working,
      zoneQuery: landmark.matchText,
    };
  }

  const commaParts = working.split(/[،,]/).map((s) => s.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const lastPart = commaParts[commaParts.length - 1];
    if (isValidZoneTailCandidate(lastPart)) {
      const resolved = resolveZoneQuery(lastPart);
      if (resolved.match || resolved.needsUserPick) {
        return {
          address: commaParts.slice(0, -1).join('، ') || trimmed,
          zoneQuery: lastPart,
        };
      }
    }
  }

  const words = working.split(/\s+/);
  let bestSplit = null;
  for (let len = 1; len <= Math.min(4, words.length - 1); len++) {
    const candidate = words.slice(-len).join(' ');
    if (!isValidZoneTailCandidate(candidate)) continue;

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
  if (
    isValidZoneTailCandidate(working) &&
    (fullResolved.match || fullResolved.needsUserPick) &&
    working.length < 30
  ) {
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

  let best = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const opt of options) {
    const label = normalizeText(`${opt.labelAr || ''} ${opt.labelEn || ''} ${opt.zone || ''}`);
    let score = 0;
    if (haystack && label && (haystack.includes(label) || label.includes(haystack))) {
      score += 85;
    }
    const words = haystack.split(' ').filter((w) => w.length >= 3);
    for (const w of words) {
      if (label.includes(w)) score += 18;
    }
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = opt;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  if (best && bestScore >= 55 && bestScore - secondScore >= 12) {
    return best;
  }

  if (options.length === 1) return options[0];
  return null;
}

function mergeLandmarkQuery(fields) {
  if (fields.government && fields.zone) {
    return fields;
  }
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

  const reconciled = reconcileDraftContext(next, {
    lang: opts?.lang || 'ar',
    replaceZone: opts?.replaceZone === true || next.replaceZone === true,
    trustUserZone: opts?.trustUserZone === true,
  });
  next = reconciled.fields;
  Object.assign(regionHints, reconciled.hints);
  if (next.replaceZone !== undefined) delete next.replaceZone;

  next = mergeLandmarkQuery(next);

  const needsAddressSplit =
    opts?.splitAddress &&
    next.address &&
    (!next.zoneQuery || !next.government || !next.zone || regionHints.zoneCorrectedFromAddress);

  if (needsAddressSplit) {
    const split = splitAddressAndZoneFromText(next.address);
    if (split.zoneQuery) {
      const prevZoneQuery = next.zoneQuery;
      const existingNorm = normalizeText(prevZoneQuery || '');
      const splitNorm = normalizeText(split.zoneQuery);
      const addressNorm = normalizeText(next.address || '');
      const userChoseDifferentZone =
        existingNorm &&
        existingNorm !== splitNorm &&
        !addressNorm.includes(existingNorm);
      if (!userChoseDifferentZone) {
        next.zoneQuery = split.zoneQuery;
        if (split.address) next.address = split.address;
      }
    } else if (split.address && !next.zoneQuery) {
      next.address = split.address;
    }
  }

  if (next.government && next.zone) {
    const valid = isValidGovernmentAndZone(next.government, next.zone);
    if (valid.ok) {
      next.government = valid.government;
      next.zone = valid.zone;
      regionHints.confirmed = { government: next.government, zone: next.zone };
      delete next.zoneQuery;
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

/**
 * Match user reply to a zone option from the disambiguation list.
 * Handles full labels, numeric picks, and phrases like "لا المنطقه عابدين".
 */
function matchZoneFromUserReply(message, options) {
  if (!options || !options.length) return null;

  const trimmed = String(message || '').trim();
  if (!trimmed) return null;

  const num = parseInt(trimmed, 10);
  if (Number.isFinite(num) && num >= 1 && num <= options.length) {
    return options[num - 1];
  }

  const resolved = resolveZoneQuery(trimmed);
  if (resolved.match) {
    const exact = options.find(
      (opt) =>
        opt.government === resolved.match.government && opt.zone === resolved.match.zone
    );
    if (exact) return exact;
    return resolved.match;
  }

  const trimmedLower = trimmed.toLowerCase();
  const trimmedNorm = normalizeText(trimmed).toLowerCase();

  for (const opt of options) {
    const labelAr = opt.labelAr || '';
    const labelEn = opt.labelEn || '';
    if (
      (labelAr && labelAr.toLowerCase() === trimmedLower) ||
      (labelEn && labelEn.toLowerCase() === trimmedLower) ||
      (labelAr && labelAr.toLowerCase().includes(trimmedLower)) ||
      (labelEn && labelEn.toLowerCase().includes(trimmedLower)) ||
      (opt.zone && opt.zone.toLowerCase() === trimmedLower)
    ) {
      return opt;
    }
  }

  for (const opt of options) {
    const candidates = [
      opt.labelAr,
      opt.labelEn,
      opt.zone,
      ...(String(opt.labelAr || '').split(/\s*-\s*/)),
      ...(String(opt.labelEn || '').split(/\s*-\s*/)),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const token = normalizeText(candidate).toLowerCase();
      if (token.length >= 3 && trimmedNorm.includes(token)) {
        return opt;
      }
    }
  }

  return null;
}

/**
 * Resolve a zone pick from quick-reply text or catalog (same data as create-order page).
 */
function resolveZonePickFromMessage(message, regionOptions) {
  const fromList = matchZoneFromUserReply(message, regionOptions);
  if (fromList) return fromList;

  const trimmed = String(message || '').trim();
  if (!trimmed) return null;

  const resolved = resolveZoneQuery(trimmed);
  if (resolved.match) return resolved.match;

  return null;
}

module.exports = {
  applyRegionResolution,
  formatZoneForDisplay,
  resolveZoneQuery,
  splitAddressAndZoneFromText,
  pickPreferredAmbiguousZone,
  isValidGovernmentAndZone,
  matchZoneFromUserReply,
  resolveZonePickFromMessage,
};
