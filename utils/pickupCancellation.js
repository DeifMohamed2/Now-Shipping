/**
 * Shared rules for business-side pickup status transitions.
 */

/** Soft-cancel: not for `new` (business uses hard-delete). Includes driver-assigned. */
const BUSINESS_PICKUP_CANCELLABLE_STATUSES = ['pendingPickup', 'driverAssigned'];

/** Edit pickup fields: only while no driver has been assigned yet. */
const BUSINESS_PICKUP_EDITABLE_STATUSES = ['new', 'pendingPickup'];

/** Hard-delete (full removal): same window as editable. */
const BUSINESS_PICKUP_HARD_DELETE_STATUSES = ['new', 'pendingPickup'];

function canBusinessCancelPickupStatus(picikupStatus) {
  return BUSINESS_PICKUP_CANCELLABLE_STATUSES.includes(picikupStatus);
}

function canBusinessEditPickupStatus(picikupStatus) {
  return BUSINESS_PICKUP_EDITABLE_STATUSES.includes(picikupStatus);
}

function canBusinessHardDeletePickupStatus(picikupStatus) {
  return BUSINESS_PICKUP_HARD_DELETE_STATUSES.includes(picikupStatus);
}

module.exports = {
  BUSINESS_PICKUP_CANCELLABLE_STATUSES,
  BUSINESS_PICKUP_EDITABLE_STATUSES,
  BUSINESS_PICKUP_HARD_DELETE_STATUSES,
  canBusinessCancelPickupStatus,
  canBusinessEditPickupStatus,
  canBusinessHardDeletePickupStatus,
};
