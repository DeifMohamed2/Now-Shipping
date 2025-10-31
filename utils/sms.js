const axios = require('axios');

const WHY_SMS_API_URL = 'https://bulk.whysms.com/api/v3/sms/send';
const WHY_SMS_TOKEN = '900|FH1B9hv7Py6gDIJyTnXKuC90W6LjldaGVT27YgWn528cc069';
const DEFAULT_SENDER_ID = 'NowShipping';

async function sendSms({ recipient, message, senderId = DEFAULT_SENDER_ID, type = 'plain' }) {
  if (!recipient || !message) {
    throw new Error('recipient and message are required');
  }

  const payload = {
    recipient,
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
    return response.data;
  } catch (error) {
    const details = error.response?.data || error.message;
    const err = new Error('WhySMS API error');
    err.details = details;
    throw err;
  }
}

module.exports = {
  sendSms,
};


