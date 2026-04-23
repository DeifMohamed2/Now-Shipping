/**
 * Business / admin UI + API alignment for order edit and cancel eligibility.
 *
 * Edit: any order type (Deliver / Return / Exchange) while status is in the editable set
 *       (through `inStock`, not `inProgress+`) and no delivery courier is assigned yet.
 * Cancel: any non-terminal status except `new` — business must use delete for brand-new orders.
 * Admin: any non-terminal status (unchanged).
 */

const ADDRESS_EDITABLE_STATUSES = new Set([
  'new',
  'pendingPickup',
  'packed',
  'shipping',
  'pickedUp',
  'inStock',
  'waitingAction',
  'rescheduled',
]);

function hasDeliveryManAssigned(order) {
  if (!order || order.deliveryMan == null || order.deliveryMan === '') return false;
  return true;
}

/** Finished / closed — no further cancel from business */
const TERMINAL_CANCEL_STATUSES = new Set([
  'completed',
  'returnCompleted',
  'canceled',
  'returned',
  'terminated',
]);

function canBusinessChangeAddress(order) {
  if (!order) return false;
  if (hasDeliveryManAssigned(order)) return false;
  return ADDRESS_EDITABLE_STATUSES.has(order.orderStatus);
}

function canAdminChangeAddress(order) {
  if (!order) return false;
  if (hasDeliveryManAssigned(order)) return false;
  return ADDRESS_EDITABLE_STATUSES.has(order.orderStatus);
}

function canBusinessCancelOrder(order) {
  if (!order) return false;
  if (order.orderStatus === 'new') return false;
  return !TERMINAL_CANCEL_STATUSES.has(order.orderStatus);
}

function canAdminCancelOrder(order) {
  if (!order) return false;
  return !TERMINAL_CANCEL_STATUSES.has(order.orderStatus);
}

function canBusinessCancel(order) {
  return canBusinessCancelOrder(order);
}

function canAdminCancel(order) {
  return canAdminCancelOrder(order);
}

module.exports = {
  ADDRESS_EDITABLE_STATUSES,
  TERMINAL_CANCEL_STATUSES,
  hasDeliveryManAssigned,
  canBusinessCancelOrder,
  canAdminCancelOrder,
  canBusinessChangeAddress,
  canAdminChangeAddress,
  canBusinessCancel,
  canAdminCancel,
};
