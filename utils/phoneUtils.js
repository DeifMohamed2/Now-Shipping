/**
 * Normalize Egyptian phone number to international format (e.g. 201012345678)
 */
function normalizeEgyptNumber(rawPhone, countryCode = '20') {
  const phoneAsString = (typeof rawPhone === 'string' ? rawPhone : String(rawPhone || '')).trim();
  if (!phoneAsString) return null;

  let cleaned = phoneAsString.replace(/\D/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }

  const cc = String(countryCode || '20').replace(/^0+/, '');
  let combined = `${cc}${cleaned}`.replace(/\D/g, '');

  if (!combined.startsWith('2')) {
    combined = `2${combined}`;
  }

  return combined;
}

/**
 * Convert phone number to WhatsApp JID format (e.g. 201012345678@s.whatsapp.net)
 */
function toJid(phone, countryCode = '20') {
  const normalized = normalizeEgyptNumber(phone, countryCode);
  if (!normalized) return null;
  return `${normalized}@s.whatsapp.net`;
}

module.exports = {
  normalizeEgyptNumber,
  toJid,
};
