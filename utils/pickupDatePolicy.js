/**
 * Pickups must be scheduled from tomorrow onward (not same-day).
 */
const PICKUP_MIN_LEAD_DAYS = 1;

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

function getEarliestPickupDate() {
  return addCalendarDays(new Date(), PICKUP_MIN_LEAD_DAYS);
}

function getDefaultPickupDate() {
  return getEarliestPickupDate();
}

function toIsoDateString(date) {
  const d = startOfLocalDay(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getEarliestPickupDateIso() {
  return toIsoDateString(getEarliestPickupDate());
}

function isValidPickupDate(date) {
  if (!date) return false;
  const d = date instanceof Date ? startOfLocalDay(date) : startOfLocalDay(new Date(date));
  if (Number.isNaN(d.getTime())) return false;
  return d >= getEarliestPickupDate();
}

function getPickupDateTooEarlyMessage(lang) {
  return lang === 'ar'
    ? 'تاريخ الاستلام لازم يكون بكرة أو بعد كده. اختار بكرة أو تاريخ لاحق.'
    : 'Pickup must be scheduled for tomorrow or later.';
}

function getPickupDateTooEarlyApiError() {
  return 'Pickup date must be tomorrow or later.';
}

module.exports = {
  PICKUP_MIN_LEAD_DAYS,
  getEarliestPickupDate,
  getDefaultPickupDate,
  getEarliestPickupDateIso,
  toIsoDateString,
  isValidPickupDate,
  getPickupDateTooEarlyMessage,
  getPickupDateTooEarlyApiError,
};
