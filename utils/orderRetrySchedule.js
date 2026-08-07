/**
 * Shared logic for scheduling delivery retries (business + admin).
 */

function ensureInProgressStageDoc(order) {
  if (!order.orderStages) {
    order.orderStages = {};
  }
  if (!order.orderStages.inProgress) {
    order.orderStages.inProgress = {
      isCompleted: false,
      completedAt: null,
      notes: '',
    };
  }
}

function applyInProgressRetryTouch(order, notes) {
  ensureInProgressStageDoc(order);
  if (!order.orderStages.inProgress.isCompleted) {
    order.orderStages.inProgress.isCompleted = true;
    order.orderStages.inProgress.completedAt = new Date();
    order.orderStages.inProgress.notes = notes;
  }
  if (typeof order.markModified === 'function') {
    order.markModified('orderStages');
  }
}

function formatRetryNoteDate(when) {
  return when.toLocaleString('en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * @param {import('mongoose').Document} order
 * @param {Date} when
 * @param {{ actor?: 'admin' | 'business', note?: string }} [options]
 */
function applyOrderRetrySchedule(order, when, options = {}) {
  const actor = options.actor === 'admin' ? 'admin' : 'business';
  const whenDate = when instanceof Date ? when : new Date(when);
  const formatted = formatRetryNoteDate(whenDate);

  order.scheduledRetryAt = whenDate;

  const defaultNote =
    actor === 'admin'
      ? `Retry scheduled by admin for ${formatted}`
      : options.note || `Retry scheduled for ${formatted}`;

  applyInProgressRetryTouch(order, options.note || defaultNote);

  order.orderStatus = 'rescheduled';
  order.$locals = order.$locals || {};
  order.$locals.nextStatusHistoryNote = defaultNote;
}

module.exports = {
  applyOrderRetrySchedule,
  applyInProgressRetryTouch,
  ensureInProgressStageDoc,
};
