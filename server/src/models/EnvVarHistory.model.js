const mongoose = require('mongoose');

const envVarHistorySchema = new mongoose.Schema({
  project:   { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  key:       { type: String, required: true },
  value:     { type: String }, // Stored AES-encrypted, or null/empty if action is 'delete'
  scopes:    { type: [String], default: ['production', 'preview', 'development'] },
  action:    { type: String, enum: ['create', 'update', 'delete', 'restore'], required: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

envVarHistorySchema.index({ project: 1, key: 1 });
envVarHistorySchema.index({ project: 1, timestamp: -1 });

module.exports = mongoose.model('EnvVarHistory', envVarHistorySchema);
