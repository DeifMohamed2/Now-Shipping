const axios = require('axios');

const BASE_URL = process.env.WASENDER_API_URL || 'https://wasenderapi.com/api';
const ACCESS_TOKEN = process.env.WASENDER_ACCESS_TOKEN || '3991|ITpv7a7BMimHURAqhPDqbsiS65ANfrE5nCSQJ6xl55c5d97a';

class WasenderClient {
  constructor(accessToken = ACCESS_TOKEN) {
    this.accessToken = accessToken;
  }

  createSessionClient(sessionApiKey) {
    return axios.create({
      baseURL: BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionApiKey}`,
      },
      timeout: 30000,
    });
  }

  async sendTextMessage(sessionApiKey, toJid, text) {
    try {
      const client = this.createSessionClient(sessionApiKey);
      const r = await client.post('/send-message', { to: toJid, text });
      const body = r.data;

      if (!body.success) {
        return { success: false, message: body.error || 'Failed to send message' };
      }

      return { success: true, data: body.data ?? body };
    } catch (error) {
      console.error('Wasender send error:', error.response?.status, error.response?.data);
      return { success: false, message: 'Failed to send message', error: error.response?.data };
    }
  }
}

module.exports = new WasenderClient();
