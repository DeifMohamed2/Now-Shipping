/**
 * Map Shopify shipping_address + province/city strings to Now fee governorates and Cairo Bosta zones.
 */
const { governmentCategories } = require('./fees');
const {
  normalizeGovKey,
  resolveZoneForGovernorate,
  getCairoZoneValues,
  bostaRegions,
} = require('./deliveryZonesBosta');

/** Flatten fee regions → canonical city names */
function allGovernorateLabels() {
  const set = new Map();
  for (const cities of Object.values(governmentCategories)) {
    for (const c of cities) set.set(c.toLowerCase(), c);
  }
  return set;
}

const LABELS = allGovernorateLabels();

/** Safe default when no Cairo area can be inferred (avoid `zones[0]` — JSON order starts with "15 May"). */
const DEFAULT_CAIRO_ZONE = 'Nasr City - Tag Sultan';

/**
 * Best-effort resolve Shopify province/city to a fee-table governorate name.
 */
function resolveGovernmentFromShopify(addr) {
  if (!addr || typeof addr !== 'object') return 'Cairo';
  // Province first (Shopify Egypt often maps governorate here), then city, then country label.
  const candidates = [addr.province, addr.city, addr.country].filter(Boolean).map((s) => String(s).trim());
  for (const raw of candidates) {
    const lower = raw.toLowerCase();
    if (LABELS.has(lower)) return LABELS.get(lower);
    for (const [k, v] of LABELS.entries()) {
      if (lower.includes(k) || k.includes(lower)) return v;
    }
    const compact = lower.replace(/[^a-z]/gi, '');
    if (compact === 'cairo' || compact === 'alqahira') return 'Cairo';
    if (compact === 'giza' || compact === 'gizah') return 'Giza';
    if (compact === 'alexandria') return 'Alexandria';
  }
  return 'Cairo';
}

/** Lowercase + collapse whitespace for fuzzy match */
function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match a Cairo Bosta zone from free text (Shopify city / address / province).
 * Tries substring on zone value, then EN/AR labels (longest first).
 */
function matchCairoZoneFromFreeText(combinedRaw) {
  const combined = normText(combinedRaw);
  if (!combined) return null;

  const cairo = bostaRegions.Cairo;
  const areas = cairo && Array.isArray(cairo.areas) ? cairo.areas : [];
  if (!areas.length) return null;

  const byLen = [...areas].sort((a, b) => String(b.value || '').length - String(a.value || '').length);

  for (const a of byLen) {
    const v = normText(a.value);
    if (v && combined.includes(v)) return a.value;
  }
  for (const a of byLen) {
    const en = a.label && a.label.en ? normText(a.label.en) : '';
    const ar = a.label && a.label.ar ? String(a.label.ar).trim() : '';
    if (en && combined.includes(en)) return a.value;
    if (ar && combined.includes(ar)) return a.value;
  }

  return null;
}

/**
 * Score Cairo Bosta zones by overlap with Shopify **City** (customer types district there).
 * Picks the zone whose `value` contains the most / longest matching tokens.
 */
function scoreBestZoneFromShopifyCity(addr, areas) {
  const cityOnly = normText(addr && addr.city);
  if (!cityOnly) return null;
  const words = cityOnly.split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return null;

  let best = null;
  let bestScore = 0;
  let bestLen = 0;
  for (const a of areas) {
    const zl = normText(a.value);
    let score = 0;
    for (const w of words) {
      if (zl.includes(w)) score += w.length;
    }
    const zlen = String(a.value || '').length;
    if (score > bestScore || (score === bestScore && score > 0 && zlen > bestLen)) {
      bestScore = score;
      best = a.value;
      bestLen = zlen;
    }
  }
  return bestScore >= 4 ? best : null;
}

/**
 * Resolve Cairo zone from free-text (district / address lines).
 * Shopify Egypt checkout: customers type the area in "City" — prioritize that field.
 */
function resolveCairoZone(addr, hints = []) {
  const govKey = normalizeGovKey('Cairo');
  const cairo = bostaRegions.Cairo;
  const areas = cairo && Array.isArray(cairo.areas) ? cairo.areas : [];
  const zones = getCairoZoneValues();

  const chunks = [];
  if (addr && typeof addr === 'object') {
    chunks.push(addr.city, addr.province, addr.address1, addr.address2);
  }
  for (const h of hints) chunks.push(h);
  const combined = chunks.filter(Boolean).join(' ');
  if (!combined.trim()) {
    return DEFAULT_CAIRO_ZONE;
  }

  const fuzzy = matchCairoZoneFromFreeText(combined);
  if (fuzzy) return fuzzy;

  const fromCity = scoreBestZoneFromShopifyCity(addr, areas);
  if (fromCity) return fromCity;

  const words = combined.split(/[\s,]+/).filter(Boolean);
  for (let len = Math.min(8, words.length); len >= 1; len--) {
    for (let start = 0; start <= words.length - len; start++) {
      const slice = words.slice(start, start + len).join(' ');
      const z = resolveZoneForGovernorate(govKey, slice);
      if (z) return z;
    }
  }

  const lower = normText(combined);
  for (const z of zones) {
    if (lower.includes(z.toLowerCase().slice(0, 12))) return z;
  }

  return DEFAULT_CAIRO_ZONE;
}

/**
 * @returns {{ government: string, zone: string }}
 */
function mapShopifyShippingToNowGovernorateZone(shippingAddress) {
  const government = resolveGovernmentFromShopify(shippingAddress);
  const govKey = normalizeGovKey(government);
  if (govKey === 'Cairo') {
    return { government: 'Cairo', zone: resolveCairoZone(shippingAddress) };
  }
  const city =
    shippingAddress && shippingAddress.city ? String(shippingAddress.city).trim() : '';
  const addr1 =
    shippingAddress && shippingAddress.address1 ? String(shippingAddress.address1).trim() : '';
  // Outside Cairo, Now uses governorate for fees; zone = customer-entered city/district (Shopify "City").
  const zone = city || addr1 || government;
  return { government, zone };
}

module.exports = {
  resolveGovernmentFromShopify,
  mapShopifyShippingToNowGovernorateZone,
};
