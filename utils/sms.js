const axios = require('axios');

const WHY_SMS_API_URL = 'https://bulk.whysms.com/api/v3/sms/send';
const WHY_SMS_TOKEN = '900|FH1B9hv7Py6gDIJyTnXKuC90W6LjldaGVT27YgWn528cc069';
const DEFAULT_SENDER_ID = 'NowShipping';

function normalizeRecipient(recipient) {
  // Trim spaces and leading '+'
  let r = String(recipient).trim().replace(/^\+/, '');
  // Convert local Egyptian mobile like 01XXXXXXXXX to 201XXXXXXXXX
  if (/^0\d{10}$/.test(r)) {
    return `20${r.slice(1)}`;
  }
  // If already starts with 20 and correct length, keep
  if (/^20\d{10}$/.test(r)) {
    return r;
  }
  // If looks like 201XXXXXXXXX with extra spaces or dashes, strip non-digits
  const digits = r.replace(/\D/g, '');
  if (/^20\d{10}$/.test(digits)) {
    return digits;
  }
  // Fallback to original sanitized digits
  return digits || r;
}

async function sendSms({ recipient, message, senderId = DEFAULT_SENDER_ID, type = 'plain' }) {
  if (!recipient || !message) {
    throw new Error('recipient and message are required');
  }

  const normalizedRecipient = normalizeRecipient(recipient);

  const payload = {
    recipient: normalizedRecipient,
    sender_id: senderId,
    type,
    message,
  };

  const headers = {
    Authorization: `Bearer ${WHY_SMS_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    const response = await axios.post(WHY_SMS_API_URL, payload, { headers });
    const status = response.data?.data?.status || response.data?.status;
    console.log(`📱 SMS → ${normalizedRecipient} | ${status}`);
    return response.data;
  } catch (error) {
    const status = error.response?.status || 'NO_RESPONSE';
    const detail = error.response?.data?.message || error.message;
    console.error(`❌ SMS failed → ${normalizedRecipient} | ${status} | ${detail}`);
    
    const err = new Error('WhySMS API error');
    err.details = error.response?.data || error.message;
    err.response = error.response;
    throw err;
  }
}

module.exports = {
  sendSms,
};


