/**
 * Shop checkout delivery: resolve saved business pickup addresses into orderCustomer snapshot fields.
 * LEGACY_PRIMARY_SENTINEL maps User.pickUpAdress (legacy single address).
 */

const LEGACY_PRIMARY_SENTINEL = 'legacy_primary';
const MANUAL_SENTINEL = '__manual__';

function buildLineAddress(addr) {
  if (!addr) return '';
  const parts = [addr.adressDetails, addr.nearbyLandmark].filter(
    (p) => p && String(p).trim()
  );
  return parts.join(' — ').trim();
}

function defaultFullName(user) {
  if (!user) return 'Customer';
  return (
    user.name ||
    user.brandInfo?.contactPersonName ||
    user.brandInfo?.brandName ||
    'Customer'
  );
}

/**
 * Resolve a saved pickup row for the authenticated business user.
 * @param {import('mongoose').Document} user - Business User document
 * @param {string} pickupAddressId - addressId, legacy_primary, or manual sentinel (caller should skip manual)
 * @returns {{ ok: true, savedPickupAddressId: string, base: object } | { ok: false, error: string }}
 */
function resolveShopDeliveryFromUser(user, pickupAddressId) {
  if (!pickupAddressId || pickupAddressId === MANUAL_SENTINEL) {
    return { ok: false, error: 'Not a saved pickup selection' };
  }

  let row = null;
  let savedId = null;

  if (pickupAddressId === LEGACY_PRIMARY_SENTINEL) {
    const legacy = user.pickUpAdress;
    if (legacy && (legacy.city || legacy.adressDetails)) {
      row = legacy;
      savedId = LEGACY_PRIMARY_SENTINEL;
    }
  } else if (user.pickUpAddresses && user.pickUpAddresses.length) {
    row = user.pickUpAddresses.find((a) => a.addressId === pickupAddressId);
    if (row) savedId = row.addressId;
  }

  if (!row) {
    return { ok: false, error: 'Invalid pickup address' };
  }

  const government = (row.city && String(row.city).trim()) || '';
  const zone = (row.zone && String(row.zone).trim()) || '';
  let address = buildLineAddress(row);
  if (!address) address = '—';

  const phoneRaw = row.pickupPhone || user.phone;
  const phoneNumber =
    phoneRaw !== undefined && phoneRaw !== null ? String(phoneRaw).trim() : '';

  const base = {
    fullName: defaultFullName(user),
    phoneNumber,
    address,
    government,
    zone,
  };

  return {
    ok: true,
    savedPickupAddressId: savedId,
    base,
  };
}

/**
 * Overlay non-empty form values on top of resolved base (user may edit for this order only).
 * @param {object} base - from resolveShopDeliveryFromUser
 * @param {object} overrides - trimmed strings from req.body
 */
function mergeDeliveryWithOverrides(base, overrides) {
  const keys = ['fullName', 'phoneNumber', 'address', 'government', 'zone'];
  const out = { ...base };
  keys.forEach((k) => {
    const v = overrides[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      out[k] = String(v).trim();
    }
  });
  return out;
}

/** Saved pickup: only contact fields may be overridden; location stays from profile. */
function mergeSavedPickupContactOnly(base, { fullName, phoneNumber }) {
  const out = { ...base };
  if (fullName !== undefined && fullName !== null && String(fullName).trim() !== '') {
    out.fullName = String(fullName).trim();
  }
  if (phoneNumber !== undefined && phoneNumber !== null && String(phoneNumber).trim() !== '') {
    out.phoneNumber = String(phoneNumber).trim();
  }
  return out;
}

function isCompleteOrderCustomer(c) {
  return !!(
    c &&
    String(c.fullName || '').trim() &&
    String(c.phoneNumber || '').trim() &&
    String(c.address || '').trim() &&
    String(c.government || '').trim() &&
    String(c.zone || '').trim()
  );
}

module.exports = {
  LEGACY_PRIMARY_SENTINEL,
  MANUAL_SENTINEL,
  resolveShopDeliveryFromUser,
  mergeDeliveryWithOverrides,
  mergeSavedPickupContactOnly,
  isCompleteOrderCustomer,
};
