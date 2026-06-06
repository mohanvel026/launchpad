const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const Project     = require('../models/Project.model');
const { createPreviewEnvironment, destroyPreviewEnvironment, getPreviewStatus } = require('../services/previewEnv.service');
const path        = require('path');

const router = express.Router();

// POST /api/previews/:projectId — create a PR preview environment
router.post('/:projectId', protect, async (req, res) => {
  try {
    const { prNumber, prBranch } = req.body;
    if (!prNumber || !prBranch) return res.status(400).json({ message: 'prNumber and prBranch are required' });

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!project.subdomain) return res.status(400).json({ message: 'Project has no subdomain assigned yet. Deploy first.' });

    // Check if preview already exists for this PR
    const existingPreview = project.previews?.find(p => p.prNumber === parseInt(prNumber));
    if (existingPreview && existingPreview.status === 'live') {
      return res.json({ message: 'Preview already live', preview: existingPreview });
    }

    // Mark as building
    await Project.findByIdAndUpdate(project._id, {
      $pull: { previews: { prNumber: parseInt(prNumber) } }
    });
    await Project.findByIdAndUpdate(project._id, {
      $push: { previews: { prNumber: parseInt(prNumber), branch: prBranch, status: 'building' } }
    });

    // Build the GitHub clone URL from repoFullName
    const token = req.user.githubToken || req.user.accessToken;
    const cloneUrl = token
      ? `https://${token}@github.com/${project.repoFullName}.git`
      : `https://github.com/${project.repoFullName}.git`;

    // Run in background so the request doesn't time out
    res.json({ message: 'Preview environment is building...', prNumber, prBranch, status: 'building' });

    setImmediate(async () => {
      try {
        const result = await createPreviewEnvironment(project, prNumber, prBranch, cloneUrl);
        await Project.findByIdAndUpdate(project._id, {
          $pull: { previews: { prNumber: parseInt(prNumber) } }
        });
        await Project.findByIdAndUpdate(project._id, {
          $push: {
            previews: {
              prNumber: parseInt(prNumber),
              branch: prBranch,
              containerId: result.containerId,
              port: result.port,
              subdomain: result.subdomain,
              status: 'live',
              previewUrl: result.previewUrl,
              createdAt: new Date(),
            }
          }
        });
        console.log(`[Preview] PR #${prNumber} live at ${result.previewUrl}`);
      } catch (buildErr) {
        console.error(`[Preview] Build failed for PR #${prNumber}:`, buildErr.message);
        await Project.findByIdAndUpdate(project._id, {
          $pull: { previews: { prNumber: parseInt(prNumber) } }
        });
        await Project.findByIdAndUpdate(project._id, {
          $push: { previews: { prNumber: parseInt(prNumber), branch: prBranch, status: 'failed', error: buildErr.message } }
        });
      }
    });
  } catch (err) {
    console.error('[Preview Route] Create error:', err.message);
    res.status(500).json({ message: 'Preview creation failed', error: err.message });
  }
});

// GET /api/previews/:projectId — list all previews
router.get('/:projectId', protect, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    }).select('previews subdomain');
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Enrich with live container status
    const previews = (project.previews || []).map(p => {
      if (p.status === 'live') {
        const status = getPreviewStatus(project, p.prNumber);
        return { ...p.toObject(), containerRunning: status.running, containerStatus: status.status };
      }
      return p.toObject ? p.toObject() : p;
    });

    res.json({ previews });
  } catch (err) {
    res.status(500).json({ message: 'Failed to list previews', error: err.message });
  }
});

// DELETE /api/previews/:projectId/:prNumber — destroy a preview
router.delete('/:projectId/:prNumber', protect, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    await destroyPreviewEnvironment(project, req.params.prNumber);

    await Project.findByIdAndUpdate(project._id, {
      $pull: { previews: { prNumber: parseInt(req.params.prNumber) } }
    });

    res.json({ message: `Preview for PR #${req.params.prNumber} destroyed successfully` });
  } catch (err) {
    console.error('[Preview Route] Destroy error:', err.message);
    res.status(500).json({ message: 'Preview destruction failed', error: err.message });
  }
});

// GET /api/previews/:projectId/:prNumber/status — live status check
router.get('/:projectId/:prNumber/status', protect, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id }).select('_id');
    if (!project) return res.status(404).json({ message: 'Project not found' });
    const status = getPreviewStatus(project, req.params.prNumber);
    res.json(status);
  } catch (err) {
    res.status(500).json({ message: 'Status check failed', error: err.message });
  }
});

module.exports = router;
