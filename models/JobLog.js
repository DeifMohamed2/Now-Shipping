const mongoose = require('mongoose');

const jobLogSchema = new mongoose.Schema({
  jobName: { type: String, required: true },
  date: { type: Date, required: true, unique: true },
});


const JobLog = mongoose.model('JobLog', jobLogSchema);

module.exports = JobLog;

