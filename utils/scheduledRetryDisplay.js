/**
 * Human-friendly labels for scheduledRetryAt (orders list + detail UI).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DEFAULT_LABELS = {
  retryTomorrow: 'Retry tomorrow',
  retryInDays: 'Retry in {n} days',
  retryInWeeks: 'Retry in {n} week(s)',
  retryOnDate: 'Retry on {date}',
  retryScheduledShort: 'Retry scheduled',
  retryPendingConfirmation: 'Retry scheduled — awaiting confirmation',
};

const AR_LABELS = {
  retryTomorrow: 'إعادة المحاولة غداً',
  retryInDays: 'إعادة المحاولة خلال {n} أيام',
  retryInWeeks: 'إعادة المحاولة خلال {n} أسبوع',
  retryOnDate: 'إعادة المحاولة في {date}',
  retryScheduledShort: 'إعادة المحاولة مجدولة',
  retryPendingConfirmation: 'إعادة المحاولة مجدولة — بانتظار التأكيد',
};

function labelsForLocale(locale) {
  const loc = resolveLocale(locale);
  return loc === 'ar' ? AR_LABELS : DEFAULT_LABELS;
}

function interpolate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : `{${key}}`
  );
}

function resolveLocale(locale) {
  if (!locale || typeof locale !== 'string') return 'en';
  return locale.split(/[-_]/)[0] || 'en';
}

function getDaysUntil(when, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  return Math.round((startOfTarget - startOfToday) / MS_PER_DAY);
}

function formatAbsoluteLabel(when, locale) {
  const loc = resolveLocale(locale);
  return when.toLocaleString(loc === 'ar' ? 'ar-EG' : 'en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function getRelativeLabel(when, locale, labels = DEFAULT_LABELS) {
  const days = getDaysUntil(when);
  if (days <= 0) return labels.retryTomorrow;
  if (days === 1) return labels.retryTomorrow;
  if (days < 7) return interpolate(labels.retryInDays, { n: days });
  const weeks = Math.round(days / 7);
  if (days % 7 === 0 || weeks >= 2) {
    return interpolate(labels.retryInWeeks, { n: weeks });
  }
  return interpolate(labels.retryInDays, { n: days });
}

/**
 * @param {object} order - plain object or mongoose doc with orderStatus + scheduledRetryAt
 * @param {string} [locale]
 * @param {object} [labels] - i18n overrides
 */
function getScheduledRetryDisplay(order, locale, labels) {
  const scheduledRetryAt = order?.scheduledRetryAt;
  const resolvedLabels = labels || labelsForLocale(locale);
  if (!scheduledRetryAt) {
    return {
      hasRetry: false,
      isConfirmed: false,
      scheduledRetryAt: null,
      relativeLabel: null,
      absoluteLabel: null,
      pillText: null,
    };
  }

  const when = scheduledRetryAt instanceof Date ? scheduledRetryAt : new Date(scheduledRetryAt);
  if (Number.isNaN(when.getTime())) {
    return {
      hasRetry: false,
      isConfirmed: false,
      scheduledRetryAt: null,
      relativeLabel: null,
      absoluteLabel: null,
      pillText: null,
    };
  }

  const isConfirmed = order.orderStatus === 'rescheduled';
  const absoluteLabel = formatAbsoluteLabel(when, locale);
  const relativeLabel = getRelativeLabel(when, locale, resolvedLabels);

  let pillText;
  if (isConfirmed) {
    pillText = relativeLabel;
  } else if (order.orderStatus === 'waitingAction' || order.orderStatus === 'inStock') {
    pillText = resolvedLabels.retryPendingConfirmation;
  } else {
    pillText = resolvedLabels.retryScheduledShort;
  }

  return {
    hasRetry: true,
    isConfirmed,
    scheduledRetryAt: when.toISOString(),
    relativeLabel,
    absoluteLabel,
    pillText,
  };
}

module.exports = {
  getScheduledRetryDisplay,
  getRelativeLabel,
  formatAbsoluteLabel,
  labelsForLocale,
  DEFAULT_LABELS,
  AR_LABELS,
};
