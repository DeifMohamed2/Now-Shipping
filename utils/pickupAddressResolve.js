/**
 * Resolve business pickup addresses for orders (default = isDefault, else first).
 */

/**
 * @param {Array<{ addressId?: string, isDefault?: boolean }>|null|undefined} pickUpAddresses
 * @returns {string|null}
 */
function getDefaultPickupAddressId(pickUpAddresses) {
  if (!Array.isArray(pickUpAddresses) || pickUpAddresses.length === 0) {
    return null;
  }
  const def = pickUpAddresses.find((a) => a && a.isDefault && a.addressId);
  if (def && def.addressId) return String(def.addressId);
  const first = pickUpAddresses.find((a) => a && a.addressId);
  return first && first.addressId ? String(first.addressId) : null;
}

/**
 * @param {Array<{ addressId?: string }>|null|undefined} pickUpAddresses
 * @param {string|null|undefined} addressId
 * @returns {object|null} matching subdocument or null
 */
function findPickupAddressById(pickUpAddresses, addressId) {
  if (!addressId || !Array.isArray(pickUpAddresses)) return null;
  const id = String(addressId).trim();
  return pickUpAddresses.find((a) => a && String(a.addressId) === id) || null;
}

/**
 * Resolve which pickup address applies to an order for display / API.
 * Falls back to default when id is missing or no longer matches.
 *
 * @param {{ selectedPickupAddressId?: string|null }} order
 * @param {{ pickUpAddresses?: Array<object> }|null|undefined} businessUser — populated business or user doc
 * @returns {{ addressId: string|null, address: object|null }}
 */
function resolvePickupAddressForOrder(order, businessUser) {
  const list = businessUser && Array.isArray(businessUser.pickUpAddresses)
    ? businessUser.pickUpAddresses
    : [];
  if (!list.length) {
    return { addressId: null, address: null };
  }
  const selectedId =
    order && order.selectedPickupAddressId != null && order.selectedPickupAddressId !== ''
      ? String(order.selectedPickupAddressId).trim()
      : '';
  if (selectedId) {
    const match = findPickupAddressById(list, selectedId);
    if (match) {
      return { addressId: selectedId, address: match };
    }
  }
  const fallbackId = getDefaultPickupAddressId(list);
  const address = fallbackId ? findPickupAddressById(list, fallbackId) : null;
  return { addressId: fallbackId, address };
}

module.exports = {
  getDefaultPickupAddressId,
  findPickupAddressById,
  resolvePickupAddressForOrder,
};
