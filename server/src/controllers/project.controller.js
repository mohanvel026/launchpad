const axios   = require('axios');
const Project = require('../models/Project.model');
const { listUserRepos, createWebhook } = require('../services/github.service');

// ─── GET /api/projects/repos ─────────────────────────────────────────────────
const getUserRepos = async (req, res) => {
  try {
    const repos = await listUserRepos(req.user.githubAccessToken);
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch GitHub repos: ' + err.message });
  }
};

// ─── POST /api/projects/repos/analyze ────────────────────────────────────────
// Auto-detects stack, branches, and .env.example vars for one-click deploys
const analyzeRepo = async (req, res) => {
  const { repoFullName } = req.body;
  if (!repoFullName) return res.status(400).json({ message: 'repoFullName is required' });

  const token = req.user.githubAccessToken;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' };

  try {
    // Parallel fetch: repo info + branches + root file tree
    const [repoRes, branchRes, treeRes] = await Promise.all([
      axios.get(`https://api.github.com/repos/${repoFullName}`, { headers }),
      axios.get(`https://api.github.com/repos/${repoFullName}/branches?per_page=50`, { headers }),
      axios.get(`https://api.github.com/repos/${repoFullName}/git/trees/HEAD?recursive=0`, { headers }).catch(() => null),
    ]);

    const repo = repoRes.data;
    const branches = branchRes.data.map(b => b.name);
    const files = (treeRes?.data?.tree || []).map(f => f.path).filter(f => !f.includes('/'));

    // Try to fetch package.json for AI stack detection
    let pkg = null;
    try {
      const pkgRes = await axios.get(`https://api.github.com/repos/${repoFullName}/contents/package.json`, { headers });
      pkg = JSON.parse(Buffer.from(pkgRes.data.content, 'base64').toString('utf-8'));
    } catch { /* not a node project */ }

    // Try to fetch .env.example for auto env var discovery
    let envExampleVars = [];
    const envCandidates = ['.env.example', '.env.template', '.env.sample'];
    for (const candidate of envCandidates) {
      try {
        const envRes = await axios.get(`https://api.github.com/repos/${repoFullName}/contents/${candidate}`, { headers });
        const content = Buffer.from(envRes.data.content, 'base64').toString('utf-8');
        envExampleVars = content.split('\n')
          .filter(l => l.includes('=') && !l.trim().startsWith('#') && l.trim())
          .map(l => {
            const eq = l.indexOf('=');
            return { key: l.slice(0, eq).trim(), placeholder: l.slice(eq + 1).trim() || '' };
          })
          .filter(e => e.key);
        break;
      } catch { /* file not found */ }
    }

    // AI-powered stack detection
    const { detectStackWithAI } = require('../services/ai.service');
    const { detectStack } = require('../services/stackDetector.service');
    let stack = await detectStackWithAI(files, pkg);
    if (stack === 'unknown' && pkg) {
      // Local fallback: scan deps
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) stack = 'next';
      else if (deps.nuxt) stack = 'nuxt';
      else if (deps.astro) stack = 'astro';
      else if (deps['@sveltejs/kit'] || deps.svelte) stack = 'svelte';
      else if (deps.vue) stack = 'vue';
      else if (deps['@angular/core']) stack = 'angular';
      else if (deps.react) stack = 'react';
      else if (deps.express || deps.fastify) stack = 'node';
      else stack = 'static';
    }

    res.json({
      stack,
      branches,
      defaultBranch: repo.default_branch,
      language: repo.language,
      description: repo.description,
      hasEnvExample: envExampleVars.length > 0,
      envExampleVars,
      files,
    });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ message: 'Repo not found or inaccessible' });
    res.status(500).json({ message: 'Repo analysis failed: ' + err.message });
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
  const { repoFullName, branch = 'main', name, framework, installCommand, buildCommand, outputDir } = req.body;
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
      ...(installCommand ? { installCommand } : {}),
      ...(buildCommand   ? { buildCommand }   : {}),
      ...(outputDir      ? { outputDir }      : {}),
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
  const allowed = ['name', 'branch', 'installCommand', 'buildCommand', 'outputDir', 'autoHeal', 'autoHealStrategy'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, owner: req.user._id },
      updates,
      { returnDocument: 'after' }
    );
    if (!project) return res.status(404).json({ message: 'Project not found' });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/projects/:id/clear-stuck ──────────────────────────────────────
const clearProjectStuckBuild = async (req, res) => {
  try {
    const Deployment = require('../models/Deployment.model');
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, $or: [{ owner: req.user._id }, { collaborators: req.user._id }] },
      { status: 'failed' },
      { returnDocument: 'after' }
    );
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Mark active/queued builds as failed/aborted
    await Deployment.updateMany(
      { project: project._id, status: { $in: ['queued', 'building'] } },
      { $set: { status: 'failed', aiErrorSummary: 'Build aborted by developer (Force reset)' } }
    );

    res.json({ message: 'Build status successfully reset to unblock deployment.', project });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/projects/:id/resize-limits ────────────────────────────────────
const resizeResourceLimits = async (req, res) => {
  const { cpuLimit, ramLimitMB } = req.body;
  if (!cpuLimit || !ramLimitMB) {
    return res.status(400).json({ message: 'cpuLimit and ramLimitMB are required' });
  }

  try {
    const project = await Project.findOne({
      _id: req.params.id,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Update resource bounds in db
    project.cpuLimit = parseFloat(cpuLimit);
    project.ramLimitMB = parseInt(ramLimitMB);
    await project.save();

    // Hot-swap active container resize if running
    if (project.containerId && project.status === 'live') {
      const Docker = require('dockerode');
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const { runContainer, stopContainer } = require('../services/docker.service');
      const { getNextFreePort } = require('../services/portAllocator.service');
      const { createNginxConfig } = require('../services/nginx.service');
      const { invalidateProjectCache } = require('../middleware/projectProxy.middleware');

      try {
        const container = docker.getContainer(project.containerId);
        const info = await container.inspect();
        const activeImage = info.Config.Image;
        const exposedPortKey = Object.keys(info.Config.ExposedPorts || {})[0] || '3000/tcp';
        const internalPort = parseInt(exposedPortKey.split('/')[0]) || 3000;

        // Allocate a new runtime port for zero-downtime hot-swap
        const newPort = await getNextFreePort();

        // Extract env variables
        const envVars = {};
        info.Config.Env.forEach(e => {
          const [k, v] = e.split('=');
          envVars[k] = v;
        });

        // Run the new container with modified resource boundaries
        const newContainerId = await runContainer(
          activeImage,
          newPort,
          envVars,
          null,
          internalPort,
          project.cpuLimit,
          project.ramLimitMB
        );

        // Update the reverse proxy target
        createNginxConfig(project.subdomain, newPort, false, project.customDomain);
        invalidateProjectCache(project.subdomain);

        // Terminate and clean up the old container
        await stopContainer(project.containerId);

        // Update Project DB port and active ContainerId
        project.containerId = newContainerId;
        project.port = newPort;
        await project.save();

        return res.json({
          message: `Zero-downtime hot-swap sizing resized successfully to ${project.cpuLimit} CPU, ${project.ramLimitMB}MB RAM!`,
          project
        });
      } catch (dockerErr) {
        console.error('[Resource Resizing Hot-Swap Error]:', dockerErr.message);
        return res.json({
          message: `Resource limits updated in db, but container rebuild skipped: ${dockerErr.message}`,
          project
        });
      }
    }

    res.json({ message: 'Resource bounds updated successfully for next deployment.', project });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/projects/:id/readiness ───────────────────────────────────────────────
const deploymentReadinessCheck = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const path = require('path');
    const REPOS_DIR = path.join(__dirname, '../../repos');
    const repoPath = path.join(REPOS_DIR, project._id.toString());
    const fs = require('fs');
    if (!fs.existsSync(repoPath)) return res.json({ score: 0, checks: [], message: 'Repository not cloned yet. Deploy first.' });

    const { generateDeploymentReadinessReport } = require('../services/ai.service');
    const report = await generateDeploymentReadinessReport(repoPath, project.stack || 'unknown');

    // Save readiness score to project
    await Project.findByIdAndUpdate(project._id, { readinessScore: report.score });

    res.json(report);
  } catch (err) {
    console.error('[Readiness]', err.message);
    res.status(500).json({ message: 'Readiness check failed', error: err.message });
  }
};

module.exports = {
  getUserRepos, analyzeRepo, getProjects, createProject,
  getProject, deleteProject, registerWebhook,
  updateProject, clearProjectStuckBuild,
  resizeResourceLimits, deploymentReadinessCheck,
};