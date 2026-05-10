const crypto     = require('crypto');
const Deployment = require('../models/Deployment.model');
const Project    = require('../models/Project.model');
const buildQueue = require('../workers/build.worker');
const { stopContainer, runContainer } = require('../services/docker.service');

// ─── POST /api/deploy/webhook ─────────────────────────────────────────────────
// GitHub calls this on every push. Verifies signature, finds the project,
// creates a Deployment record, and queues a build.
const githubWebhook = async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const secret    = process.env.GITHUB_WEBHOOK_SECRET || '';

  // Verify the request really came from GitHub
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
    // Find the project that matches this repo + branch
    const project = await Project.findOne({ repoFullName, branch });
    if (!project) {
      // Webhook fired for a repo we don't track — just acknowledge
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
      { attempts: 1, removeOnComplete: 50, removeOnFail: 50 }
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

    // Prevent concurrent builds
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
      { attempts: 1, removeOnComplete: 50, removeOnFail: 50 }
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
      .select('-logs');       // omit logs in list view (too large)

    res.json({ deployments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/deploy/:projectId/:deploymentId ─────────────────────────────────
const getDeployment = async (req, res) => {
  try {
    const deployment = await Deployment.findById(req.params.deploymentId)
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
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const target = await Deployment.findOne({
      _id:     req.params.deploymentId,
      project: project._id,
      status:  'success',
    });
    if (!target || !target.imageTag) {
      return res.status(404).json({ message: 'No successful deployment found to roll back to' });
    }

    // Stop the currently running container
    if (project.containerId) await stopContainer(project.containerId);

    // Spin up the old image on the same port
    const containerId = await runContainer(target.imageTag, project.port, {}, null);

    await Project.findByIdAndUpdate(project._id, { containerId, status: 'live' });

    res.json({ message: `Rolled back to commit ${target.commitSha}`, containerId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { githubWebhook, triggerDeploy, getDeployments, getDeployment, rollback };