// models/OtpVerification.js
const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  otpHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 360 }, // 6 minutes TTL
});

const OtpVerification = mongoose.model('OtpVerification', otpVerificationSchema);

module.exports = OtpVerification;
