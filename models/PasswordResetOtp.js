const mongoose = require('mongoose');

/**
 * Short-lived phone OTP for business account password reset (TTL index on createdAt).
 */
const passwordResetOtpSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    otpHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 900 },
  },
  { versionKey: false }
);

passwordResetOtpSchema.index({ phoneNumber: 1 });

const PasswordResetOtp = mongoose.model('PasswordResetOtp', passwordResetOtpSchema);

module.exports = PasswordResetOtp;
