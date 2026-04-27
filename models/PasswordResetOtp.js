const mongoose = require('mongoose');

/**
 * Short-lived email OTP for business account password reset (TTL index on createdAt).
 */
const passwordResetOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    otpHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 900 },
  },
  { versionKey: false }
);

passwordResetOtpSchema.index({ email: 1 });

const PasswordResetOtp = mongoose.model('PasswordResetOtp', passwordResetOtpSchema);

module.exports = PasswordResetOtp;
