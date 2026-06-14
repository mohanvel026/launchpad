const jwt  = require('jsonwebtoken');
const User = require('../models/User.model');

// Standard protect — no githubAccessToken
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ message: 'Not authorized, no token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-githubAccessToken');
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token invalid or expired' });
  }
};

// Use this when you need to call GitHub API (includes the token)
const getUserWithToken = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ message: 'Not authorized, no token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('+githubAccessToken +githubRefreshToken githubTokenExpiresAt');
    if (!req.user) return res.status(401).json({ message: 'User not found' });

    // Ensure token is valid and refresh if necessary
    const { ensureValidGithubToken } = require('../services/github.service');
    req.user.githubAccessToken = await ensureValidGithubToken(req.user);

    next();
  } catch (err) {
    res.status(401).json({ message: 'Token invalid or expired' });
  }
};

module.exports = { protect, getUserWithToken };