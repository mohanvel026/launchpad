const mongoose = require('mongoose');

const webhookSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  name: { type: String, required: true },
  url: { type: String, required: true },
  type: { type: String, enum: ['slack', 'discord'], default: 'slack' },
  events: [{ type: String, enum: ['start', 'success', 'failure'] }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Webhook', webhookSchema);
