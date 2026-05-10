const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  githubId:          { type: String, required: true, unique: true },
  username:          { type: String, required: true },
  email:             { type: String },
  avatarUrl:         { type: String },
  githubAccessToken: { type: String, select: false },
  plan:              { type: String, enum: ['free', 'pro'], default: 'free' },
  appLimit:          { type: Number, default: 3 },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);