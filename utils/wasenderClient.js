const axios = require('axios');

const BASE_URL = (process.env.WASENDER_API_URL || 'https://wasenderapi.com/api').replace(/\/$/, '');
const ACCESS_TOKEN = process.env.WASENDER_ACCESS_TOKEN || '5096|0nDNzNwkWqRqGqpwwpoYt6QwFb3P0BlDWpuuHJFhd6ff5085';

/** Shown when env and legacy fallback both yield no personal token. */
const MSG_NO_PERSONAL_TOKEN =
  'Wasender personal access token is not configured. Set WASENDER_ACCESS_TOKEN in your environment.';

class WasenderClient {
  constructor(accessToken = ACCESS_TOKEN) {
    this.accessToken = accessToken;
  }

  /**
   * Personal access token (Wasender dashboard): same resolution as constructor — env first, then legacy fallback in ACCESS_TOKEN.
   */
  getPersonalAccessToken() {
    const fromEnv = process.env.WASENDER_ACCESS_TOKEN;
    if (fromEnv != null && String(fromEnv).trim() !== '') {
      return String(fromEnv).trim();
    }
    return String(ACCESS_TOKEN || '').trim();
  }

  hasPersonalAccessToken() {
    return this.getPersonalAccessToken() !== '';
  }

  /**
   * Account-level API (Wasender personal access token). Used for session list / QR / connect.
   */
  createAccountClient() {
    const token = this.getPersonalAccessToken();
    if (!token) {
      return null;
    }
    return axios.create({
      baseURL: BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 30000,
    });
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

  async listWhatsAppSessions() {
    const client = this.createAccountClient();
    if (!client) {
      return { success: false, message: MSG_NO_PERSONAL_TOKEN };
    }
    try {
      const r = await client.get('/whatsapp-sessions');
      const body = r.data;
      if (!body) {
        return { success: false, message: 'Empty response from Wasender' };
      }
      if (body.success === false) {
        return {
          success: false,
          message: body?.error || body?.message || 'Failed to list WhatsApp sessions',
          raw: body,
        };
      }
      return { success: true, data: body.data ?? [] };
    } catch (error) {
      console.error('Wasender list sessions:', error.response?.status, error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to list sessions',
        error: error.response?.data,
      };
    }
  }

  async connectWhatsAppSession(sessionId) {
    const client = this.createAccountClient();
    if (!client) {
      return { success: false, message: MSG_NO_PERSONAL_TOKEN };
    }
    const id = Number(sessionId);
    if (!Number.isFinite(id) || id < 1) {
      return { success: false, message: 'Invalid session id' };
    }
    try {
      const r = await client.post(`/whatsapp-sessions/${id}/connect`);
      const body = r.data;
      if (!body || body.success === false) {
        return {
          success: false,
          message: body?.error || body?.message || 'Connect failed',
          raw: body,
        };
      }
      return { success: true, data: body.data ?? body };
    } catch (error) {
      console.error('Wasender connect:', error.response?.status, error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Connect failed',
        error: error.response?.data,
      };
    }
  }

  async getWhatsAppSessionQrCode(sessionId) {
    const client = this.createAccountClient();
    if (!client) {
      return { success: false, message: MSG_NO_PERSONAL_TOKEN };
    }
    const id = Number(sessionId);
    if (!Number.isFinite(id) || id < 1) {
      return { success: false, message: 'Invalid session id' };
    }
    try {
      const r = await client.get(`/whatsapp-sessions/${id}/qrcode`);
      const body = r.data;
      if (!body || body.success === false) {
        return {
          success: false,
          message: body?.error || body?.message || 'Failed to get QR code',
          raw: body,
        };
      }
      return { success: true, data: body.data ?? body };
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || '';
      const benignQr =
        status === 400 &&
        (String(msg).includes('does not need scanning') ||
          String(msg).includes('initialize the session'));
      if (!benignQr) {
        console.error('Wasender QR:', status, error.response?.data);
      }
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to get QR code',
        error: error.response?.data,
      };
    }
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

const wasenderSingleton = new WasenderClient();
wasenderSingleton.MSG_NO_PERSONAL_TOKEN = MSG_NO_PERSONAL_TOKEN;
module.exports = wasenderSingleton;
