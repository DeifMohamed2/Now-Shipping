const ADDRESS_EDITABLE_STATUSES = new Set([
  'new',
  'pendingPickup',
  'packed',
  'shipping',
  'inProgress',
  'pickedUp',
  'inStock',
  'waitingAction',
  'rescheduled',
]);

const CANCELABLE_STATUSES = new Set([
  'new',
  'pendingPickup',
  'packed',
  'shipping',
  'inProgress',
  'pickedUp',
  'inStock',
  'waitingAction',
  'rescheduled',
  'returnToWarehouse',
]);

function isReturnType(order) {
  return order?.orderShipping?.orderType === 'Return';
}

function canBusinessChangeAddress(order) {
  if (!order || isReturnType(order)) return false;
  return ADDRESS_EDITABLE_STATUSES.has(order.orderStatus);
}

function canAdminChangeAddress(order) {
  if (!order || isReturnType(order)) return false;
  return ADDRESS_EDITABLE_STATUSES.has(order.orderStatus);
}

function canBusinessCancel(order) {
  if (!order || isReturnType(order)) return false;
  return CANCELABLE_STATUSES.has(order.orderStatus);
}

function canAdminCancel(order) {
  if (!order || isReturnType(order)) return false;
  return CANCELABLE_STATUSES.has(order.orderStatus);
}

module.exports = {
  ADDRESS_EDITABLE_STATUSES,
  CANCELABLE_STATUSES,
  canBusinessChangeAddress,
  canAdminChangeAddress,
  canBusinessCancel,
  canAdminCancel,
};
