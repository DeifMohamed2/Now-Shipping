/**
 * AES-256-GCM encryption for Shopify offline access tokens at rest.
 * Set SHOPIFY_TOKEN_ENCRYPTION_KEY to 64 hex chars (32 bytes), or falls back to hashing JWT_SECRET (dev only).
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;

function getKeyBuffer() {
  const raw = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const fallback = process.env.JWT_SECRET || 'nodedemo';
  return crypto.createHash('sha256').update(String(fallback)).digest();
}

function encryptToken(plainText) {
  if (plainText == null || plainText === '') return '';
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptToken(payloadB64) {
  if (!payloadB64) return '';
  const key = getKeyBuffer();
  const buf = Buffer.from(payloadB64, 'base64');
  if (buf.length < IV_LEN + AUTH_TAG_LEN + 1) return '';
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const enc = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encryptToken, decryptToken };
