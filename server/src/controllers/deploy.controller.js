const crypto     = require('crypto');
const Deployment = require('../models/Deployment.model');
const Project    = require('../models/Project.model');
const buildQueue = require('../workers/build.worker');
const { stopContainer, runContainer, stopContainerOnly, startContainer, restartContainer } = require('../services/docker.service');
const { emitProjectUpdate } = require('../sockets/logs.socket');

const notifyUpdate = async (projectId) => {
  try {
    const project = await Project.findById(projectId);
    const deployments = await Deployment.find({ project: projectId }).sort({ createdAt: -1 }).limit(10);
    emitProjectUpdate(projectId, { project, deployments });
  } catch (err) {
    console.error('Failed to notify real-time update:', err.message);
  }
};

// ─── POST /api/deploy/webhook ─────────────────────────────────────────────────
const githubWebhook = async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const secret    = process.env.GITHUB_WEBHOOK_SECRET;

  if (secret) {
    if (!signature) {
      return res.status(401).json({ message: 'Missing webhook signature' });
    }
    const hmac     = crypto.createHmac('sha256', secret);
    const bodyStr  = req.rawBody || JSON.stringify(req.body);
    const digest   = 'sha256=' + hmac.update(bodyStr).digest('hex');
    if (signature !== digest) {
      return res.status(401).json({ message: 'Invalid webhook signature' });
    }
  }

  const { repository, ref, after: commitSha, head_commit } = req.body;
  if (!repository) return res.status(400).json({ message: 'No repository in payload' });

  const repoFullName = repository.full_name;
  const branch       = ref?.replace('refs/heads/', '') || 'main';

  try {
    const project = await Project.findOne({ repoFullName, branch });
    if (!project) {
      return res.status(200).json({ message: 'No matching project found, ignoring' });
    }

    const running = await Deployment.findOne({ project: project._id, status: { $in: ['queued', 'building'] } });
    if (running) {
      return res.status(200).json({ message: 'A build is already queued or in progress for this project, ignoring webhook trigger' });
    }

    const EnvVar = require('../models/EnvVar.model');
    const envVars = await EnvVar.find({ project: project._id }).sort({ key: 1 });
    const envStr = envVars.map(ev => `${ev.key}=${ev.value}`).join('\n');
    const envVarsHash = crypto.createHash('md5').update(envStr).digest('hex');

    const settingsStr = `${project.installCommand || ''}|${project.buildCommand || ''}|${project.outputDir || ''}|${project.branch || ''}|${project.cpuLimit || ''}|${project.ramLimitMB || ''}`;
    const settingsHash = crypto.createHash('md5').update(settingsStr).digest('hex');

    const deployment = await Deployment.create({
      project:       project._id,
      commitSha:     commitSha?.slice(0, 7),
      commitMessage: head_commit?.message || 'Push triggered deploy',
      branch,
      status:        'queued',
      envVarsHash,
      settingsHash,
    });

    await buildQueue.add(
      { 
        deploymentId: deployment._id.toString(), 
        projectId: project._id.toString(),
        forceRebuild: false
      },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50
      }
    );

    await notifyUpdate(project._id);
    res.status(200).json({ message: 'Build queued', deploymentId: deployment._id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/deploy/:projectId — manual trigger ────────────────────────────
const triggerDeploy = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const running = await Deployment.findOne({ project: project._id, status: { $in: ['queued', 'building'] } });
    if (running) return res.status(409).json({ message: 'A build is already in progress' });

    const EnvVar = require('../models/EnvVar.model');
    const envVars = await EnvVar.find({ project: project._id }).sort({ key: 1 });
    const envStr = envVars.map(ev => `${ev.key}=${ev.value}`).join('\n');
    const envVarsHash = crypto.createHash('md5').update(envStr).digest('hex');

    const settingsStr = `${project.installCommand || ''}|${project.buildCommand || ''}|${project.outputDir || ''}|${project.branch || ''}|${project.cpuLimit || ''}|${project.ramLimitMB || ''}`;
    const settingsHash = crypto.createHash('md5').update(settingsStr).digest('hex');

    const forceRebuild = req.body?.forceRebuild === true;

    const deployment = await Deployment.create({
      project:       project._id,
      triggeredBy:   req.user._id,
      commitSha:     'manual',
      commitMessage: forceRebuild ? 'Manual deploy (clean rebuild)' : 'Manual deploy',
      branch:        project.branch,
      status:        'queued',
      envVarsHash,
      settingsHash,
    });

    await buildQueue.add(
      { 
        deploymentId: deployment._id.toString(), 
        projectId: project._id.toString(),
        forceRebuild
      },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50
      }
    );

    await notifyUpdate(project._id);
    res.status(202).json({ deployment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/deploy/:projectId — deployment history ─────────────────────────
const getDeployments = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [deployments, total] = await Promise.all([
      Deployment.find({ project: project._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('triggeredBy', 'username avatarUrl')
        .select('-logs'),
      Deployment.countDocuments({ project: project._id }),
    ]);

    res.json({
      deployments,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        totalDeployments: total,
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/deploy/:projectId/:deploymentId ─────────────────────────────────
const getDeployment = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const deployment = await Deployment.findOne({ _id: req.params.deploymentId, project: project._id })
      .populate('triggeredBy', 'username avatarUrl');
    if (!deployment) return res.status(404).json({ message: 'Deployment not found' });
    res.json({ deployment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/deploy/:projectId/rollback/:deploymentId ──────────────────────
const rollback = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, $or: [{ owner: req.user._id }, { collaborators: req.user._id }] });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const target = await Deployment.findOne({
      _id:     req.params.deploymentId,
      project: project._id,
      status:  'success',
    });
    if (!target || !target.imageTag) {
      return res.status(404).json({ message: 'No successful deployment found to roll back to' });
    }

    if (project.containerId) await stopContainer(project.containerId);

    const containerId = await runContainer(target.imageTag, project.port, {}, null, 3000, project.cpuLimit || 0.5, project.ramLimitMB || 512);

    const rollbackDep = await Deployment.create({
      project: project._id,
      triggeredBy: req.user._id,
      commitSha: target.commitSha,
      commitMessage: `🔄 Rollback to ${target.commitSha.slice(0, 7)} — ${target.commitMessage || 'previous deployment'}`,
      branch: target.branch || project.branch,
      status: 'success',
      duration: 1500,
      imageTag: target.imageTag,
      rollbackFrom: target._id,
    });

    await Project.findByIdAndUpdate(project._id, { containerId, status: 'live' });

    await notifyUpdate(project._id);
    res.json({ message: `Rolled back to commit ${target.commitSha}`, containerId, deployment: rollbackDep });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/deploy/:projectId/cancel — cancel a queued/building deploy ────
const cancelDeploy = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const activeDeployment = await Deployment.findOne({
      project: project._id,
      status: { $in: ['queued', 'building'] },
    }).sort({ createdAt: -1 });

    if (!activeDeployment) {
      return res.status(404).json({ message: 'No active deployment to cancel' });
    }

    // Mark as failed/cancelled in the DB
    await Deployment.findByIdAndUpdate(activeDeployment._id, {
      status: 'failed',
      finishedAt: new Date(),
      $push: { logs: `[${new Date().toLocaleTimeString()}] 🛑 Deployment cancelled by ${req.user.username}` },
    });

    // Try to remove from Bull queue (best-effort)
    try {
      const jobs = await buildQueue.getJobs(['waiting', 'active', 'delayed']);
      for (const job of jobs) {
        if (job.data?.deploymentId === activeDeployment._id.toString()) {
          await job.remove();
          break;
        }
      }
    } catch (qErr) {
      console.warn('[cancelDeploy] Could not remove job from queue:', qErr.message);
    }

    // Reset project status if it was building
    if (project.status === 'building') {
      await Project.findByIdAndUpdate(project._id, { status: 'failed' });
    }

    await notifyUpdate(project._id);
    res.json({ message: 'Deployment cancelled', deploymentId: activeDeployment._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/deploy/:projectId/stop — stop a running container (without remove) ───
const stopProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!project.containerId) return res.status(400).json({ message: 'No container running for this project' });

    await stopContainerOnly(project.containerId);
    await Project.findByIdAndUpdate(project._id, { status: 'stopped' });
    await notifyUpdate(project._id);
    res.json({ message: 'Container stopped successfully', status: 'stopped' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/deploy/:projectId/start — start a stopped container ────────────
const startProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!project.containerId) return res.status(400).json({ message: 'No container found. Please redeploy.' });

    await startContainer(project.containerId);
    await Project.findByIdAndUpdate(project._id, { status: 'live' });
    await notifyUpdate(project._id);
    res.json({ message: 'Container started successfully', status: 'live' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/deploy/:projectId/restart — restart a container ────────────────
const restartProject = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!project.containerId) return res.status(400).json({ message: 'No container found. Please redeploy.' });

    await restartContainer(project.containerId);
    await Project.findByIdAndUpdate(project._id, { status: 'live' });
    await notifyUpdate(project._id);
    res.json({ message: 'Container restarted successfully', status: 'live' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/deploy/recent-activity — get recent deployments across all user projects ───
const getRecentActivity = async (req, res) => {
  try {
    const projects = await Project.find({
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    }).select('_id name');

    const projectIds = projects.map(p => p._id);

    const deployments = await Deployment.find({ project: { $in: projectIds } })
      .sort({ createdAt: -1 })
      .limit(15)
      .populate('triggeredBy', 'username avatarUrl')
      .populate('project', 'name subdomain customDomain')
      .select('-logs');

    res.json({ deployments });
  } catch (err) {
    console.error('[Recent Activity]', err.message);
    res.status(500).json({ message: 'Failed to fetch recent activity', error: err.message });
  }
};

// ─── Incoming Deploy Hooks (Public) ──────────────────────────────────────────
const triggerDeployHook = async (req, res) => {
  try {
    const DeployHook = require('../models/DeployHook.model');
    const hook = await DeployHook.findOne({ token: req.params.token });
    if (!hook) return res.status(404).json({ message: 'Deploy hook not found' });

    const project = await Project.findById(hook.project);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const running = await Deployment.findOne({ project: project._id, status: { $in: ['queued', 'building'] } });
    if (running) return res.status(409).json({ message: 'A build is already in progress' });

    const EnvVar = require('../models/EnvVar.model');
    const envVars = await EnvVar.find({ project: project._id }).sort({ key: 1 });
    const envStr = envVars.map(ev => `${ev.key}=${ev.value}`).join('\n');
    const envVarsHash = crypto.createHash('md5').update(envStr).digest('hex');

    const settingsStr = `${project.installCommand || ''}|${project.buildCommand || ''}|${project.outputDir || ''}|${project.branch || ''}|${project.cpuLimit || ''}|${project.ramLimitMB || ''}`;
    const settingsHash = crypto.createHash('md5').update(settingsStr).digest('hex');

    const deployment = await Deployment.create({
      project:       project._id,
      commitSha:     'hook',
      commitMessage: `Deploy Hook: ${hook.name}`,
      branch:        hook.branch,
      status:        'queued',
      envVarsHash,
      settingsHash,
    });

    await buildQueue.add(
      { 
        deploymentId: deployment._id.toString(), 
        projectId: project._id.toString(),
        forceRebuild: false
      },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50
      }
    );

    await notifyUpdate(project._id);
    res.status(202).json({ message: 'Build queued via deploy hook', deployment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Deploy Hooks Management (Protected) ─────────────────────────────────────
const getDeployHooks = async (req, res) => {
  try {
    const DeployHook = require('../models/DeployHook.model');
    const hooks = await DeployHook.find({ project: req.params.projectId });
    res.json({ hooks });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createDeployHook = async (req, res) => {
  try {
    const { name, branch } = req.body;
    if (!name || !branch) return res.status(400).json({ message: 'Name and branch are required' });

    const DeployHook = require('../models/DeployHook.model');
    const token = crypto.randomBytes(24).toString('hex');

    const hook = await DeployHook.create({
      project: req.params.projectId,
      name,
      branch,
      token
    });

    res.status(201).json({ hook });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteDeployHook = async (req, res) => {
  try {
    const DeployHook = require('../models/DeployHook.model');
    await DeployHook.findOneAndDelete({ project: req.params.projectId, _id: req.params.hookId });
    res.json({ message: 'Deploy hook deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Outgoing Webhooks Management (Protected) ────────────────────────────────
const getWebhooks = async (req, res) => {
  try {
    const Webhook = require('../models/Webhook.model');
    const webhooks = await Webhook.find({ project: req.params.projectId });
    res.json({ webhooks });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createWebhook = async (req, res) => {
  try {
    const { name, url, type, events } = req.body;
    if (!name || !url || !events || !events.length) {
      return res.status(400).json({ message: 'Name, url, and events are required' });
    }

    const Webhook = require('../models/Webhook.model');
    const webhook = await Webhook.create({
      project: req.params.projectId,
      name,
      url,
      type: type || 'slack',
      events
    });

    res.status(201).json({ webhook });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteWebhook = async (req, res) => {
  try {
    const Webhook = require('../models/Webhook.model');
    await Webhook.findOneAndDelete({ project: req.params.projectId, _id: req.params.webhookId });
    res.json({ message: 'Webhook deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── SVG Badge (Public) ──────────────────────────────────────────────────────
const getProjectBadge = async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).send('Project Not Found');

    let color = '#ef4444'; // default: failed
    let text = 'failed';

    if (project.status === 'live') {
      color = '#10b981';
      text = 'live';
    } else if (project.status === 'building') {
      color = '#38bdf8';
      text = 'building';
    } else if (project.status === 'stopped' || project.status === 'idle') {
      color = '#64748b';
      text = project.status;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="120" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h55v20H0z"/>
    <path fill="${color}" d="M55 0h65v20H55z"/>
    <path fill="url(#b)" d="M0 0h120v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="27.5" y="15" fill="#010101" fill-opacity=".3">deploy</text>
    <text x="27.5" y="14">deploy</text>
    <text x="87.5" y="15" fill="#010101" fill-opacity=".3">${text}</text>
    <text x="87.5" y="14">${text}</text>
  </g>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(svg);
  } catch (err) {
    res.status(500).send('Error generating badge');
  }
};

module.exports = {
  githubWebhook, triggerDeploy, getDeployments, getDeployment, rollback,
  cancelDeploy, stopProject, startProject, restartProject, getRecentActivity,
  triggerDeployHook, getDeployHooks, createDeployHook, deleteDeployHook,
  getWebhooks, createWebhook, deleteWebhook, getProjectBadge
};