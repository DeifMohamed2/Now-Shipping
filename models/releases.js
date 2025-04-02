const mongoose = require('mongoose');

const releaseSchema = new mongoose.Schema(
  {
    releaseId: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },

    releaseType: {
      type: String,
      required: true,
      enum: ['refund', 'deposit', 'withdrawal'],
    },
    releaseStatus: {
      type: String,
      required: true,
      enum: ['pending', 'released', 'scheduled', 'failed'],
    },
    scheduledReleaseDate: {
      type: Date,
    },
    reason: {
      type: String,
    },
    releaseNotes: {
      type: String,
    },
  },
  { timestamps: true }
);

releaseSchema.pre('save', function (next) {
  if (!this.releaseId) {
    this.releaseId = Math.floor(100000 + Math.random() * 900000).toString();
  }
  
  next();
});

const Release = mongoose.model('Release', releaseSchema);

module.exports = Release;