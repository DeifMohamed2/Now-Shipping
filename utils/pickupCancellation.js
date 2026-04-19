/**
 * Shared rules for business-side pickup cancellation (soft cancel, not hard delete).
 */
const BUSINESS_PICKUP_CANCELLABLE_STATUSES = ['new', 'pendingPickup', 'driverAssigned'];

function canBusinessCancelPickupStatus(picikupStatus) {
  return BUSINESS_PICKUP_CANCELLABLE_STATUSES.includes(picikupStatus);
}

module.exports = {
  BUSINESS_PICKUP_CANCELLABLE_STATUSES,
  canBusinessCancelPickupStatus,
};
