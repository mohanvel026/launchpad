const mongoose = require('mongoose');

const deploymentSchema = new mongoose.Schema({
  project:        { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  triggeredBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  commitSha:      { type: String },
  commitMessage:  { type: String },
  branch:         { type: String },
  githubAuthor:    { type: String },
  githubAvatarUrl: { type: String },
  status:         { type: String, enum: ['queued', 'building', 'success', 'failed'], default: 'queued' },
  logs:           [{ type: String }],
  imageTag:       { type: String },
  aiErrorSummary: { type: String },
  aiDiagnosis: {
    summary:  { type: String },
    cause:    { type: String },
    fix:      { type: String },
    commands: [{ type: String }],
    missingEnvVar: { type: String }
  },
  startedAt:      { type: Date },
  finishedAt:     { type: Date },
  duration:       { type: Number },  // milliseconds
  estimatedDuration: { type: Number }, // seconds
  envVarsHash:    { type: String },
  settingsHash:   { type: String },
  isAutoHeal:     { type: Boolean, default: false },
  parentDeployment: { type: mongoose.Schema.Types.ObjectId, ref: 'Deployment' },
  autoHealFixDescription: { type: String },
  autoHealDiff:    { type: String },
  autoHealAuditTrail: [{
    timestamp: { type: Date, default: Date.now },
    step: String,
    status: String,
    details: String
  }],
  buildPhases: [{
    phase: { type: String, enum: ['fetch', 'analyze', 'prepare', 'compile', 'deploy'] },
    status: { type: String, enum: ['pending', 'running', 'success', 'failed'], default: 'pending' },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    duration: { type: Number }, // milliseconds
    isCached: { type: Boolean, default: false }
  }],
  envOverrides: {
    type: Map,
    of: String,
    default: {}
  },
  readinessScore:    { type: Number },
  readinessChecks:   [{ name: String, passed: Boolean, recommendation: String }],
  rollbackFrom:      { type: mongoose.Schema.Types.ObjectId, ref: 'Deployment' },
  notes:             { type: String, default: '' },
}, { timestamps: true });

deploymentSchema.index({ project: 1, createdAt: -1 });

module.exports = mongoose.model('Deployment', deploymentSchema);