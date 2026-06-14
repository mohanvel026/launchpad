const mongoose = require('mongoose');

const envVarSchema = new mongoose.Schema({
  project:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  key:      { type: String, required: true },
  value:    { type: String, required: true },   // stored AES-encrypted
  isSecret: { type: Boolean, default: true },
  scopes:   { type: [String], enum: ['production', 'preview', 'development'], default: ['production', 'preview', 'development'] },
}, { timestamps: true });

module.exports = mongoose.model('EnvVar', envVarSchema);