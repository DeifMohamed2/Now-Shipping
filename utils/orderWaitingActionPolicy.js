/**
 * Eligibility for waiting-action business endpoints (retry / return-to-warehouse / cancel-from-waiting).
 * Used by businessController and exposed on order details for UI + mobile parity.
 */

const MAX_RETRY_SCHEDULE_DAYS = 90;
const PAST_SKEW_MS = 60 * 1000; // allow 1 min clock skew

function isWaitingActionStatus(order) {
  return order?.orderStatus === 'waitingAction';
}

function isRetryScheduledEligibleStatus(order) {
  return ['waitingAction', 'rescheduled'].includes(order?.orderStatus);
}

function canRetryTomorrow(order) {
  return isWaitingActionStatus(order);
}

function canRetryScheduled(order) {
  return isRetryScheduledEligibleStatus(order);
}

function canReturnToWarehouseFromWaiting(order) {
  return isWaitingActionStatus(order);
}

function canCancelFromWaiting(order) {
  return isWaitingActionStatus(order);
}

/**
 * @param {object} body - req.body (JSON or urlencoded: `date` field)
 * @returns {{ ok: true, when: Date } | { ok: false, code: string, error: string }}
 */
function validateRetryScheduledDate(body) {
  if (!body || body.date == null || String(body.date).trim() === '') {
    return { ok: false, code: 'MISSING_DATE', error: 'Retry date is required' };
  }
  const when = new Date(String(body.date).trim());
  if (Number.isNaN(when.getTime())) {
    return { ok: false, code: 'INVALID_DATE', error: 'Invalid date' };
  }
  const minTime = Date.now() - PAST_SKEW_MS;
  if (when.getTime() < minTime) {
    return { ok: false, code: 'DATE_IN_PAST', error: 'Retry must be scheduled in the future' };
  }
  const maxTime = Date.now() + MAX_RETRY_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;
  if (when.getTime() > maxTime) {
    return { ok: false, code: 'DATE_TOO_FAR', error: `Retry cannot be more than ${MAX_RETRY_SCHEDULE_DAYS} days ahead` };
  }
  return { ok: true, when };
}

/**
 * Single payload for get_orderDetailsPage / get_orderDetailsAPI
 */
function getWaitingActionFlags(order) {
  return {
    canRetryTomorrow: canRetryTomorrow(order),
    canRetryScheduled: canRetryScheduled(order),
    canReturnToWarehouseFromWaiting: canReturnToWarehouseFromWaiting(order),
    canCancelFromWaiting: canCancelFromWaiting(order),
  };
}

module.exports = {
  canRetryTomorrow,
  canRetryScheduled,
  canReturnToWarehouseFromWaiting,
  canCancelFromWaiting,
  validateRetryScheduledDate,
  getWaitingActionFlags,
  MAX_RETRY_SCHEDULE_DAYS,
};
