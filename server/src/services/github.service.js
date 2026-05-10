const axios = require('axios');

const githubApi = (token) =>
  axios.create({
    baseURL: 'https://api.github.com',
    headers: { 
      Authorization: `Bearer ${token}`, 
      Accept: 'application/vnd.github+json' 
    },
  });

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
    const res = await api.post(`/repos/${repoFullName}/hooks`, {
      name:   'web',
      active: true,
      events: ['push'],
      config: {
        url:          callbackUrl,
        content_type: 'json',
        insecure_ssl: '0',
      },
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

module.exports = { listUserRepos, createWebhook, deleteWebhook };