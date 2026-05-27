const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  owner:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  collaborators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  repoFullName:  { type: String, required: true },   // e.g. "username/my-app"
  repoUrl:       { type: String, required: true },
  branch:        { type: String, default: 'main' },
  stack:         { type: String, enum: ['react', 'node', 'mern', 'mern-split', 'fullstack-split', 'next', 'nuxt', 'static', 'unknown'], default: 'unknown' },
  framework:     { type: String }, // user-selected framework override
  subdomain:     { type: String, unique: true, sparse: true },
  customDomain:  { type: String },
  port:          { type: Number },
  containerId:   { type: String },
  installCommand: { type: String },
  buildCommand:   { type: String },
  outputDir:      { type: String },
  status:        { type: String, enum: ['idle', 'building', 'live', 'failed', 'stopped'], default: 'idle' },
  webhookId:     { type: String },
  lastDeployedAt: { type: Date },
  buildCount:    { type: Number, default: 0 },
  cpuLimit:      { type: Number, default: 0.5 },
  ramLimitMB:    { type: Number, default: 512 },
}, { timestamps: true });

projectSchema.index({ owner: 1 });
projectSchema.index({ collaborators: 1 });

module.exports = mongoose.model('Project', projectSchema);