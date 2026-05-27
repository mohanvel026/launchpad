const mongoose = require('mongoose');

const deploymentSchema = new mongoose.Schema({
  project:        { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  triggeredBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  commitSha:      { type: String },
  commitMessage:  { type: String },
  branch:         { type: String },
  status:         { type: String, enum: ['queued', 'building', 'success', 'failed'], default: 'queued' },
  logs:           [{ type: String }],
  imageTag:       { type: String },
  aiErrorSummary: { type: String },
  startedAt:      { type: Date },
  finishedAt:     { type: Date },
  duration:       { type: Number },  // milliseconds
}, { timestamps: true });

deploymentSchema.index({ project: 1, createdAt: -1 });

module.exports = mongoose.model('Deployment', deploymentSchema);