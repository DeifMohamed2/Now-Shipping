const mongoose = require('mongoose');

const jobLogSchema = new mongoose.Schema({
  jobName: { type: String, required: true },
  date: { type: Date, required: true },
  status: { 
    type: String, 
    enum: ['running', 'completed', 'failed', 'cancelled'],
    default: 'running'
  },
  batchId: { type: String, required: false },
  details: {
    startTime: { type: Date },
    endTime: { type: Date },
    ordersProcessed: { type: Number, default: 0 },
    businessesProcessed: { type: Number, default: 0 },
    errors: [{ 
      businessId: String,
      error: String,
      orderCount: Number
    }],
    success: { type: Boolean, default: true },
    message: { type: String }
  },
  lastRun: { type: Date, default: Date.now }
});

// Create a compound unique index on jobName and date
jobLogSchema.index({ jobName: 1, date: 1 }, { unique: true });
jobLogSchema.index({ batchId: 1 });
jobLogSchema.index({ status: 1 });


const JobLog = mongoose.model('JobLog', jobLogSchema);

module.exports = JobLog;

