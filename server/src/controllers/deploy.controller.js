const crypto     = require('crypto');
const Deployment = require('../models/Deployment.model');
const Project    = require('../models/Project.model');
const buildQueue = require('../workers/build.worker');
const { stopContainer, runContainer, stopContainerOnly, startContainer, restartContainer } = require('../services/docker.service');

// ─── POST /api/deploy/webhook ─────────────────────────────────────────────────
const githubWebhook = async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const secret    = process.env.GITHUB_WEBHOOK_SECRET || '';

  if (secret && signature) {
    const hmac     = crypto.createHmac('sha256', secret);
    const digest   = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
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

    const deployment = await Deployment.create({
      project:       project._id,
      commitSha:     commitSha?.slice(0, 7),
      commitMessage: head_commit?.message || 'Push triggered deploy',
      branch,
      status:        'queued',
    });

    await buildQueue.add(
      { deploymentId: deployment._id.toString(), projectId: project._id.toString() },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50
      }
    );

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

    const deployment = await Deployment.create({
      project:       project._id,
      triggeredBy:   req.user._id,
      commitSha:     'manual',
      commitMessage: 'Manual deploy',
      branch:        project.branch,
      status:        'queued',
    });

    await buildQueue.add(
      { deploymentId: deployment._id.toString(), projectId: project._id.toString() },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50
      }
    );

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

    const deployments = await Deployment.find({ project: project._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('triggeredBy', 'username avatarUrl')
      .select('-logs');

    res.json({ deployments });
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
      .populate('project', 'name')
      .select('-logs');

    res.json({ deployments });
  } catch (err) {
    console.error('[Recent Activity]', err.message);
    res.status(500).json({ message: 'Failed to fetch recent activity', error: err.message });
  }
};

module.exports = {
  githubWebhook, triggerDeploy, getDeployments, getDeployment, rollback,
  cancelDeploy, stopProject, startProject, restartProject, getRecentActivity,
};