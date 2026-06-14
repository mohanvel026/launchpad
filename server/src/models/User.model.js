const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // index: true is explicit — Mongoose also derives an index from unique:true,
  // but declaring both keeps intent clear for schema inspection tools.
  githubId:          { type: String, required: true, unique: true, index: true },
  username:          { type: String, required: true },
  email:             { type: String },
  avatarUrl:         { type: String },
  githubAccessToken: { 
    type: String, 
    select: false,
    set: require('../utils/crypto').encrypt,
    get: require('../utils/crypto').decrypt
  },
  githubRefreshToken: { 
    type: String, 
    select: false,
    set: require('../utils/crypto').encrypt,
    get: require('../utils/crypto').decrypt
  },
  githubTokenExpiresAt: { type: Date },
  plan:              { type: String, enum: ['free', 'pro'], default: 'free' },
  appLimit:          { type: Number, default: 9999 }, // Unlimited free tier by default
  notifyOnDeploy:    { type: Boolean, default: true },
  notifyOnCrash:     { type: Boolean, default: true },
}, { 
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
}); // createdAt + updatedAt are auto-managed

module.exports = mongoose.model('User', userSchema);