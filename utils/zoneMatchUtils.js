/**
 * Shared zone fuzzy-match helpers (Levenshtein, landmarks, scoring).
 */

/** Levenshtein distance with early exit if already > maxDist. */
function levenshteinCapped(a, b, maxDist) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = cur;
  }
  return prev[n];
}

function levenshteinRatio(a, b) {
  const maxLen = Math.max(a.length, b.length, 1);
  const maxDist = Math.min(48, maxLen);
  const d = levenshteinCapped(a, b, maxDist);
  if (d > maxDist) return 0;
  return 1 - d / maxLen;
}

/**
 * Landmark / colloquial boosts → canonical zone value.
 * @type {{ pattern: RegExp, government: string, zone: string, boost: number }[]}
 */
const ZONE_LANDMARK_BOOSTS = [
  { pattern: /اوبيرا|اوبرا|opera|midan\s*el?\s*opera/i, government: 'Cairo', zone: 'Abdeen - Downtown Cairo', boost: 45 },
  { pattern: /العتبه|العته|elataba|el\s*ataba/i, government: 'Cairo', zone: 'Abdeen - ElAtaba', boost: 40 },
  { pattern: /باب اللوق|bab ellouq|bab el louq/i, government: 'Cairo', zone: 'Abdeen - Bab ElLouq', boost: 40 },
  { pattern: /وسط البلد|downtown cairo|وسط البلد/i, government: 'Cairo', zone: 'Abdeen - Downtown Cairo', boost: 35 },
  { pattern: /المعادي|المعادى|elmaadi|maadi/i, government: 'Cairo', zone: 'ElMaadi', boost: 25 },
  { pattern: /مدينه نصر|مدينة نصر|madinet nasr|nasr city/i, government: 'Cairo', zone: 'Nasr City', boost: 25 },
  { pattern: /التجمع|tagamo|new cairo/i, government: 'Cairo', zone: 'New Cairo', boost: 20 },
  { pattern: /الشيخ زايد|sheikh zayed|zayed/i, government: 'Giza', zone: 'Sheikh Zayed', boost: 25 },
  { pattern: /6\s*اكتوبر|٦\s*اكتوبر|6th october|october city/i, government: 'Giza', zone: '6th of October', boost: 25 },
];

function getLandmarkBoost(queryNorm, government, zone) {
  let boost = 0;
  for (const hint of ZONE_LANDMARK_BOOSTS) {
    if (hint.pattern.test(queryNorm) && hint.government === government && hint.zone === zone) {
      boost = Math.max(boost, hint.boost);
    }
  }
  return boost;
}

function scoreLabelPair(queryNorm, labelNorm) {
  if (!queryNorm || !labelNorm) return { score: 0, reason: 'none' };

  if (labelNorm === queryNorm) {
    return { score: 100, reason: 'exact' };
  }
  if (labelNorm.includes(queryNorm) || queryNorm.includes(labelNorm)) {
    return { score: 82, reason: 'substring' };
  }

  const qWords = queryNorm.split(' ').filter((w) => w.length >= 2);
  const lWords = labelNorm.split(' ').filter((w) => w.length >= 2);
  let wordHits = 0;
  for (const qw of qWords) {
    if (lWords.some((lw) => lw.includes(qw) || qw.includes(lw))) wordHits++;
  }
  if (wordHits > 0) {
    return { score: 50 + wordHits * 12, reason: 'token' };
  }

  const lev = levenshteinRatio(queryNorm, labelNorm);
  if (lev >= 0.72) {
    return { score: Math.round(60 + lev * 30), reason: 'fuzzy' };
  }
  if (lev >= 0.45) {
    return { score: Math.round(lev * 55), reason: 'fuzzy' };
  }

  return { score: 0, reason: 'none' };
}

function scoreZoneEntry(queryNorm, entry, normalizeFn) {
  let best = 0;
  let reason = 'none';
  let matchedLabel = entry.zone;

  for (const label of entry.labels) {
    const labelNorm = normalizeFn(label);
    const result = scoreLabelPair(queryNorm, labelNorm);
    if (result.score > best) {
      best = result.score;
      reason = result.reason;
      matchedLabel = label;
    }
  }

  const landmarkBoost = getLandmarkBoost(queryNorm, entry.government, entry.zone);
  if (landmarkBoost > 0) {
    best = Math.max(best + landmarkBoost, 88);
    reason = 'landmark';
  }

  return { score: best, reason, matchedLabel };
}

/**
 * Parent zone (e.g. Abdeen) should not auto-accept when child sub-zones also match.
 */
function shouldForceParentDisambiguation(best, allScored) {
  if (!best || best.score <= 0) return false;

  const exactChild = (allScored || []).find(
    (s) => s.reason === 'exact' && String(s.zone).includes(' - ')
  );
  if (exactChild) return false;

  const isParentOnly = !String(best.zone).includes(' - ');
  if (!isParentOnly) return false;

  const children = allScored.filter(
    (s) =>
      s.government === best.government &&
      s.zone.startsWith(`${best.zone} - `) &&
      s.score >= 60
  );
  return children.length >= 1;
}

function canAutoAccept(best, second) {
  if (!best || best.score <= 0) return false;
  if (best.reason === 'exact' || best.score >= 100) {
    return !shouldForceParentDisambiguation(best, [best, second].filter(Boolean));
  }
  const gap = second ? best.score - second.score : best.score;
  return best.score >= 92 && gap >= 12;
}

function toSuggestion(row) {
  return {
    government: row.government,
    zone: row.zone,
    labelAr: row.labelAr,
    labelEn: row.labelEn,
    score: row.score,
    reason: row.reason,
  };
}

module.exports = {
  ZONE_LANDMARK_BOOSTS,
  levenshteinRatio,
  getLandmarkBoost,
  scoreLabelPair,
  scoreZoneEntry,
  shouldForceParentDisambiguation,
  canAutoAccept,
  toSuggestion,
};
