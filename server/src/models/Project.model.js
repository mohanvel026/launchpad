const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  owner:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  collaborators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  repoFullName:  { type: String, required: true },   // e.g. "username/my-app"
  repoUrl:       { type: String, required: true },
  branch:        { type: String, default: 'main' },
  stack:         { type: String, enum: ['react', 'node', 'mern', 'mern-split', 'fullstack-split', 'next', 'nuxt', 'static', 'python', 'go', 'rust', 'ruby', 'java', 'php', 'dotnet', 'unknown'], default: 'unknown' },
  framework:     { type: String }, // user-selected framework override
  subdomain:     { type: String, unique: true, sparse: true },
  customDomain:  { type: String },
  customDomainStatus: { type: String, enum: ['none', 'pending_dns', 'dns_verified', 'active', 'failed'], default: 'none' },
  sslStatus:          { type: String, enum: ['none', 'pending', 'active', 'failed'], default: 'none' },
  sslIssuedAt:        { type: Date },
  sslExpiresAt:       { type: Date },
  port:          { type: Number },
  containerId:   { type: String },
  installCommand: { type: String },
  buildCommand:   { type: String },
  outputDir:      { type: String },
  status:        { type: String, enum: ['idle', 'building', 'live', 'failed', 'stopped', 'suspended'], default: 'idle' },
  webhookId:     { type: String },
  lastDeployedAt: { type: Date },
  lastImageTag:  { type: String },   // last successful image — used for --cache-from on next build
  lastCommitSha: { type: String },   // last deployed git SHA — used to skip rebuild if unchanged
  buildCount:    { type: Number, default: 0 },
  cpuLimit:      { type: Number, default: 0.5 },
  ramLimitMB:    { type: Number, default: 512 },
  autoHeal:      { type: Boolean, default: true },
  autoHealStrategy: { type: String, enum: ['push-on-success', 'pr', 'local-only'], default: 'push-on-success' },
  previews:          [{
    prNumber:    { type: Number },
    branch:      { type: String },
    containerId: { type: String },
    port:        { type: Number },
    subdomain:   { type: String },
    status:      { type: String, enum: ['building', 'live', 'stopped', 'failed'], default: 'building' },
    previewUrl:  { type: String },
    error:       { type: String },
    createdAt:   { type: Date, default: Date.now },
  }],
  lastHealthScore:    { type: Number, default: 100 },
  lastVulnScanAt:     { type: Date },
  vulnSummary:        {
    critical: { type: Number, default: 0 },
    high:     { type: Number, default: 0 },
    medium:   { type: Number, default: 0 },
    low:      { type: Number, default: 0 },
  },
  customDockerfile:   { type: String },
  regions:            { type: [String], default: ['us-ashburn-1'] },
  cronSchedule:       { type: String, default: '' },
  cronEnabled:        { type: Boolean, default: false },
  readinessScore:     { type: Number },
}, { timestamps: true });

projectSchema.index({ owner: 1 });
projectSchema.index({ collaborators: 1 });

module.exports = mongoose.model('Project', projectSchema);