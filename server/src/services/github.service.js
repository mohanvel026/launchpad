const axios = require('axios');

const githubApi = (token) => {
  const instance = axios.create({
    baseURL: 'https://api.github.com',
    headers: { 
      Authorization: `Bearer ${token}`, 
      Accept: 'application/vnd.github+json' 
    },
  });

  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response && error.response.status === 401) {
        error.message = 'GitHub access token expired or revoked. Please log out and log in again to re-authenticate.';
        error.status = 401;
      }
      return Promise.reject(error);
    }
  );

  return instance;
};

const listUserRepos = async (accessToken) => {
  const api = githubApi(accessToken);
  const res = await api.get('/user/repos?per_page=100&sort=updated&type=all');
  return res.data.map((r) => ({
    id:            r.id,
    name:          r.name,
    fullName:      r.full_name,
    description:   r.description,
    private:       r.private,
    language:      r.language,
    defaultBranch: r.default_branch,
    updatedAt:     r.updated_at,
    url:           r.clone_url,
  }));
};

const createWebhook = async (accessToken, repoFullName, callbackUrl) => {
  const api = githubApi(accessToken);
  try {
    const config = {
      url:          callbackUrl,
      content_type: 'json',
      insecure_ssl: '0',
    };
    if (process.env.GITHUB_WEBHOOK_SECRET) {
      config.secret = process.env.GITHUB_WEBHOOK_SECRET;
    }

    const res = await api.post(`/repos/${repoFullName}/hooks`, {
      name:   'web',
      active: true,
      events: ['push'],
      config,
    });
    return res.data.id;
  } catch (err) {
    if (err.response?.status === 422) return null;
    throw err;
  }
};

const deleteWebhook = async (accessToken, repoFullName, webhookId) => {
  const api = githubApi(accessToken);
  try {
    await api.delete(`/repos/${repoFullName}/hooks/${webhookId}`);
  } catch (err) {
    console.warn('Webhook delete failed:', err.message);
  }
};

const createPullRequest = async (accessToken, repoFullName, title, head, base, body) => {
  const api = githubApi(accessToken);
  try {
    const res = await api.post(`/repos/${repoFullName}/pulls`, {
      title,
      head,
      base,
      body,
    });
    return res.data;
  } catch (err) {
    console.error('Failed to create Pull Request:', err.response?.data || err.message);
    throw err;
  }
};

const createPullRequestComment = async (accessToken, repoFullName, prNumber, commentBody) => {
  const api = githubApi(accessToken);
  try {
    const res = await api.post(`/repos/${repoFullName}/issues/${prNumber}/comments`, {
      body: commentBody,
    });
    return res.data;
  } catch (err) {
    console.error('Failed to create PR comment:', err.response?.data || err.message);
    throw err;
  }
};

const refreshAccessToken = async (userId) => {
  const User = require('../models/User.model');
  const user = await User.findById(userId).select('+githubAccessToken +githubRefreshToken');
  if (!user || !user.githubRefreshToken) return null;

  try {
    const res = await axios.post('https://github.com/login/oauth/access_token', {
      client_id:     process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: user.githubRefreshToken
    }, {
      headers: { Accept: 'application/json' }
    });

    if (res.data.access_token) {
      user.githubAccessToken = res.data.access_token;
      if (res.data.refresh_token) {
        user.githubRefreshToken = res.data.refresh_token;
      }
      if (res.data.expires_in) {
        user.githubTokenExpiresAt = new Date(Date.now() + res.data.expires_in * 1000);
      }
      await user.save();
      return user.githubAccessToken;
    }
  } catch (err) {
    console.error('Failed to refresh GitHub access token:', err.response?.data || err.message);
  }
  return null;
};

const ensureValidGithubToken = async (user) => {
  if (!user) return null;
  // If the token expires in > 5 mins, return the current token
  if (user.githubTokenExpiresAt && new Date(user.githubTokenExpiresAt) > new Date(Date.now() + 5 * 60 * 1000)) {
    return user.githubAccessToken;
  }
  // If no expires date or expired, attempt to refresh it
  if (user.githubRefreshToken) {
    const refreshedToken = await refreshAccessToken(user._id);
    if (refreshedToken) return refreshedToken;
  }
  return user.githubAccessToken;
};

module.exports = { 
  listUserRepos, 
  createWebhook, 
  deleteWebhook, 
  createPullRequest, 
  createPullRequestComment,
  refreshAccessToken,
  ensureValidGithubToken
};