const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // index: true is explicit — Mongoose also derives an index from unique:true,
  // but declaring both keeps intent clear for schema inspection tools.
  githubId:          { type: String, required: true, unique: true, index: true },
  username:          { type: String, required: true },
  email:             { type: String },
  avatarUrl:         { type: String },
  githubAccessToken: { type: String, select: false },
  plan:              { type: String, enum: ['free', 'pro'], default: 'free' },
  appLimit:          { type: Number, default: 3 },
  notifyOnDeploy:    { type: Boolean, default: true },
  notifyOnCrash:     { type: Boolean, default: true },
}, { timestamps: true }); // createdAt + updatedAt are auto-managed

module.exports = mongoose.model('User', userSchema);