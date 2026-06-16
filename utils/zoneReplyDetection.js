/**
 * Detect when user message is a zone/area answer (not a help request).
 */
const { resolveZoneQuery } = require('./bostaRegionsServer');

const HELP_ZONE_MARKERS = /(ازاي|إزاي|كيف|شرح|اشرح|how to|how do|explain|what is|ايه|what's)/i;

function isZoneLikeMessage(message) {
  const text = String(message || '').trim();
  if (!text || text.length > 180) return false;
  if (HELP_ZONE_MARKERS.test(text)) return false;
  if (/\d{10,}/.test(text.replace(/\s/g, ''))) return false;

  const resolved = resolveZoneQuery(text);
  if (resolved.match) return true;
  return !!(resolved.needsUserPick && (resolved.suggestions || resolved.options || []).length);
}

module.exports = {
  isZoneLikeMessage,
};
