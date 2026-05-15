const express = require('express');
const axios   = require('axios');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User.model');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

// STEP 1 — redirect user to GitHub OAuth
router.get('/github', (req, res) => {
  const params = new URLSearchParams({
    client_id:    process.env.GITHUB_CLIENT_ID,
    scope:        'repo,user:email,admin:repo_hook',
  });
  const url = `https://github.com/login/oauth/authorize?${params.toString()}`;
  res.redirect(url);
});

// STEP 2 — GitHub calls back here with ?code=xxx
router.get('/github/callback', async (req, res) => {
  const { code } = req.query;
  try {
    // Exchange code for GitHub access token
    const tokenRes = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id:     process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: 'application/json' } }
    );
    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('No access token returned from GitHub');

    // Fetch GitHub user profile
    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { id, login, email, avatar_url } = userRes.data;

    // Upsert user — create if first login, update token always
    const user = await User.findOneAndUpdate(
      { githubId: String(id) },
      { username: login, email, avatarUrl: avatar_url, githubAccessToken: accessToken },
      { upsert: true, new: true }
    );

    // Issue our own JWT
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Redirect to frontend with token in query param
    res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);
  } catch (err) {
    console.error('GitHub OAuth error FULL:', err.response?.data || err.message);
    res.redirect(`${process.env.CLIENT_URL}/login?error=auth_failed`);
}
});

// GET /api/auth/me — return current user
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/logout
router.post('/logout', protect, (req, res) => {
  res.json({ message: 'Logged out — delete the token on the client' });
});

module.exports = router;