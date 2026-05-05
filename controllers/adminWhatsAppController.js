const QRCode = require('qrcode');
const wasender = require('../utils/wasenderClient');

async function qrPayloadToDataUrl(payload) {
  const qrString =
    typeof payload === 'string' ? payload : payload && payload.qrCode != null ? String(payload.qrCode) : '';
  if (!qrString) return null;
  try {
    return await QRCode.toDataURL(qrString, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    });
  } catch (e) {
    console.error('WhatsApp QR encode error:', e.message);
    return null;
  }
}

const getConnectWhatsAppPage = (req, res) => {
  const hasWasenderToken = wasender.hasPersonalAccessToken();
  res.render('admin/connect-whatsapp', {
    title: 'Connect WhatsApp',
    page_title: 'Connect WhatsApp',
    folder: 'Tools',
    hasWasenderToken,
  });
};

const apiListSessions = async (req, res) => {
  if (!wasender.hasPersonalAccessToken()) {
    return res.status(503).json({ success: false, message: wasender.MSG_NO_PERSONAL_TOKEN });
  }
  const out = await wasender.listWhatsAppSessions();
  res.status(out.success ? 200 : 502).json(out);
};

const apiConnectSession = async (req, res) => {
  if (!wasender.hasPersonalAccessToken()) {
    return res.status(503).json({ success: false, message: wasender.MSG_NO_PERSONAL_TOKEN });
  }
  const out = await wasender.connectWhatsAppSession(req.params.sessionId);
  if (!out.success) {
    const status = out.message === 'Invalid session id' ? 400 : 502;
    return res.status(status).json(out);
  }
  const qrDataUrl = await qrPayloadToDataUrl(out.data);
  res.json({
    success: true,
    data: {
      ...(out.data && typeof out.data === 'object' ? out.data : {}),
      qrDataUrl,
    },
  });
};

const apiGetQr = async (req, res) => {
  if (!wasender.hasPersonalAccessToken()) {
    return res.status(503).json({ success: false, message: wasender.MSG_NO_PERSONAL_TOKEN });
  }
  const out = await wasender.getWhatsAppSessionQrCode(req.params.sessionId);
  if (!out.success) {
    const status = out.message === 'Invalid session id' ? 400 : 502;
    return res.status(status).json(out);
  }
  const qrDataUrl = await qrPayloadToDataUrl(out.data);
  res.json({
    success: true,
    data: {
      ...(out.data && typeof out.data === 'object' ? out.data : {}),
      qrDataUrl,
    },
  });
};

module.exports = {
  getConnectWhatsAppPage,
  apiListSessions,
  apiConnectSession,
  apiGetQr,
};
