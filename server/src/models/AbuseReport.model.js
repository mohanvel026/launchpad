const mongoose = require('mongoose');

const abuseReportSchema = new mongoose.Schema({
  subdomain: { type: String, required: true },
  reporterIp: { type: String, required: true },
  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'investigating', 'resolved', 'ignored'], default: 'pending' },
  aiAnalysis: {
    isPhishing: { type: Boolean },
    confidence: { type: Number },
    reasoning: { type: String }
  },
  actionTaken: { type: String, enum: ['none', 'suspended', 'warned'], default: 'none' }
}, { timestamps: true });

module.exports = mongoose.model('AbuseReport', abuseReportSchema);
