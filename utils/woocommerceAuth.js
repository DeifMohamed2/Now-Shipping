const crypto = require('crypto');

function serverKey() {
  return String(process.env.JWT_SECRET || 'nodedemo');
}

function pairingSecretDigest(secret) {
  return crypto.createHmac('sha256', serverKey()).update(`wc_pair|${secret}`).digest('hex');
}

function installationTokenDigest(token) {
  return crypto.createHmac('sha256', serverKey()).update(`wc_inst|${token}`).digest('hex');
}

function verifyHmacHex(secret, rawBodyUtf8, signatureHex) {
  if (!secret || !signatureHex || rawBodyUtf8 == null) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBodyUtf8, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(signatureHex), 'hex'));
  } catch {
    return false;
  }
}

function maxClockSkewMs() {
  return 5 * 60 * 1000;
}

function verifyTimestampHeader(tsHeader) {
  const ts = parseInt(String(tsHeader || ''), 10);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(Date.now() - ts) <= maxClockSkewMs();
}

module.exports = {
  pairingSecretDigest,
  installationTokenDigest,
  verifyHmacHex,
  verifyTimestampHeader,
};
