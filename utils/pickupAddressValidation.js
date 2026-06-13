/**
 * Pickup address helpers for AINOW and pickup drafts.
 */

function isAddressRowUsable(addr) {
  if (!addr || typeof addr !== 'object') return false;
  const details = String(addr.adressDetails || addr.addressDetails || addr.area || '').trim();
  const city = String(addr.city || '').trim();
  return !!(details || city);
}

function hasUsableLegacyPickupAddress(userData) {
  const legacy = userData?.pickUpAdress;
  if (!legacy || typeof legacy !== 'object') return false;
  return isAddressRowUsable(legacy);
}

function hasUsablePickupAddress(userData) {
  const addresses = userData?.pickUpAddresses || [];
  if (addresses.some(isAddressRowUsable)) return true;
  return hasUsableLegacyPickupAddress(userData);
}

function buildLocationFromAddress(addr) {
  if (!addr) return '';
  return [addr.adressDetails, addr.addressDetails, addr.zone, addr.city, addr.country]
    .filter(Boolean)
    .join(', ')
    .trim();
}

function getStrictPickupAddress(userData, addressId) {
  const addresses = userData?.pickUpAddresses || [];
  if (addresses.length === 0) {
    return hasUsableLegacyPickupAddress(userData) ? userData.pickUpAdress : null;
  }
  if (addresses.length === 1) {
    return addresses[0];
  }
  if (!addressId) return null;
  return addresses.find((a) => a.addressId === addressId) || null;
}

module.exports = {
  isAddressRowUsable,
  hasUsableLegacyPickupAddress,
  hasUsablePickupAddress,
  buildLocationFromAddress,
  getStrictPickupAddress,
};
