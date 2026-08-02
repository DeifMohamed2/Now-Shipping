/**
 * Pickup scheduling: same-day before 4 PM local time, next day from 4 PM onward.
 */
const PICKUP_SAME_DAY_CUTOFF_HOUR = 16;

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addCalendarDays(date, days) {
  const d = startOfLocalDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getPickupMinLeadDays(now = new Date()) {
  return now.getHours() < PICKUP_SAME_DAY_CUTOFF_HOUR ? 0 : 1;
}

/** @deprecated Use getPickupMinLeadDays() — kept for backward compatibility */
const PICKUP_MIN_LEAD_DAYS = 1;

function getEarliestPickupDate(now = new Date()) {
  return addCalendarDays(now, getPickupMinLeadDays(now));
}

function getDefaultPickupDate(now = new Date()) {
  return getEarliestPickupDate(now);
}

function toIsoDateString(date) {
  const d = startOfLocalDay(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getEarliestPickupDateIso(now = new Date()) {
  return toIsoDateString(getEarliestPickupDate(now));
}

function isValidPickupDate(date, now = new Date()) {
  if (!date) return false;
  const d = date instanceof Date ? startOfLocalDay(date) : startOfLocalDay(new Date(date));
  if (Number.isNaN(d.getTime())) return false;
  return d >= getEarliestPickupDate(now);
}

function getPickupDateTooEarlyMessage(lang, now = new Date()) {
  if (getPickupMinLeadDays(now) === 0) {
    return lang === 'ar'
      ? 'تاريخ الاستلام لازم يكون النهاردة أو بعد كده.'
      : 'Pickup must be scheduled for today or later.';
  }
  return lang === 'ar'
    ? 'تاريخ الاستلام لازم يكون بكرة أو بعد كده. بعد الساعة ٤ مساءً الاستلام نفس اليوم مش متاح.'
    : 'Pickup must be scheduled for tomorrow or later. Same-day pickup is not available after 4 PM.';
}

function getPickupDateTooEarlyApiError(now = new Date()) {
  if (getPickupMinLeadDays(now) === 0) {
    return 'Pickup date cannot be earlier than today.';
  }
  return 'Pickup date must be tomorrow or later. Same-day pickup is not available after 4 PM.';
}

module.exports = {
  PICKUP_SAME_DAY_CUTOFF_HOUR,
  PICKUP_MIN_LEAD_DAYS,
  getPickupMinLeadDays,
  getEarliestPickupDate,
  getDefaultPickupDate,
  getEarliestPickupDateIso,
  toIsoDateString,
  isValidPickupDate,
  getPickupDateTooEarlyMessage,
  getPickupDateTooEarlyApiError,
};
