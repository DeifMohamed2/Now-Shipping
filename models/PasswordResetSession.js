const mongoose = require('mongoose');

/**
 * Issued after OTP verification; allows one password change before TTL (15 min).
 */
const passwordResetSessionSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 900 },
  },
  { versionKey: false }
);

passwordResetSessionSchema.index({ tokenHash: 1 });

const PasswordResetSession = mongoose.model('PasswordResetSession', passwordResetSessionSchema);

module.exports = PasswordResetSession;
