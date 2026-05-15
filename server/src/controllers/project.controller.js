const axios   = require('axios');
const Project = require('../models/Project.model');
const { listUserRepos, createWebhook } = require('../services/github.service');

// ─── GET /api/projects/repos ─────────────────────────────────────────────────
// Returns the user's GitHub repos for the repo-picker in the UI
const getUserRepos = async (req, res) => {
  try {
    const repos = await listUserRepos(req.user.githubAccessToken);
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch GitHub repos: ' + err.message });
  }
};

// ─── GET /api/projects ────────────────────────────────────────────────────────
const getProjects = async (req, res) => {
  try {
    const projects = await Project.find({
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    })
      .populate('owner', 'username avatarUrl')
      .sort({ updatedAt: -1 });
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/projects ───────────────────────────────────────────────────────
const createProject = async (req, res) => {
  const { repoFullName, branch = 'main', name, framework } = req.body;
  if (!repoFullName) return res.status(400).json({ message: 'repoFullName is required' });

  try {
    // Validate the repo exists on GitHub
    const repoRes = await axios.get(`https://api.github.com/repos/${repoFullName}`, {
      headers: { Authorization: `Bearer ${req.user.githubAccessToken}` },
    });
    const repo = repoRes.data;

    // Build a URL-safe unique subdomain
    const baseSlug  = repo.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const subdomain = `${baseSlug}-${Date.now().toString(36)}`;

    const project = await Project.create({
      name:         name || repo.name,
      owner:        req.user._id,
      repoFullName: repo.full_name,
      repoUrl:      repo.clone_url,
      branch,
      subdomain,
      ...(framework && framework !== 'auto' ? { framework } : {}),
    });

    res.status(201).json({ project });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ message: 'Repo not found or not accessible' });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/projects/:id ────────────────────────────────────────────────────
const getProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    }).populate('owner', 'username avatarUrl');
    if (!project) return res.status(404).json({ message: 'Project not found' });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const execPromise = util.promisify(exec);

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────
const deleteProject = async (req, res) => {
  try {
    const project = await Project.findOneAndDelete({
      _id:   req.params.id,
      owner: req.user._id,       // only the owner can delete
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    
    // Clean up server resources to save storage
    try {
      const containerName = `lp-${project._id}`;
      const repoDir = path.join(__dirname, '../../repos', project._id.toString());
      
      // Stop and remove docker container, remove repo files, and remove nginx config
      await execPromise(`docker rm -f ${containerName} || true`);
      await execPromise(`rm -rf ${repoDir} || true`);
      await execPromise(`sudo rm -f /etc/nginx/sites-enabled/${project.subdomain}.conf || true`);
      await execPromise(`sudo systemctl reload nginx || true`);
    } catch (cleanupErr) {
      console.error('Failed to cleanup project resources:', cleanupErr);
    }

    res.json({ message: 'Project deleted and server resources freed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/projects/:id/webhook ──────────────────────────────────────────
// Registers a GitHub webhook so every git push triggers a deploy
const registerWebhook = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const callbackUrl = `${process.env.SERVER_URL || 'http://localhost:5000'}/api/deploy/webhook`;

    const webhookId = await createWebhook(
      req.user.githubAccessToken,
      project.repoFullName,
      callbackUrl
    );

    await Project.findByIdAndUpdate(project._id, { webhookId });
    res.json({ message: 'Webhook registered', webhookId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PATCH /api/projects/:id ──────────────────────────────────────────────────
const updateProject = async (req, res) => {
  const { name, installCommand, buildCommand, outputDir } = req.body;
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, owner: req.user._id },
      { name, installCommand, buildCommand, outputDir },
      { new: true }
    );
    if (!project) return res.status(404).json({ message: 'Project not found' });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getUserRepos, getProjects, createProject,
  getProject, deleteProject, registerWebhook,
  updateProject,
};