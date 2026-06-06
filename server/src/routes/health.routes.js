const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const Project     = require('../models/Project.model');
const { getHealthStatus, acknowledgeAlert, startMonitoring } = require('../services/healthMonitor.service');

const router = express.Router();

// GET /api/health/:projectId — get current health status
router.get('/:projectId', protect, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, $or: [{ owner: req.user._id }, { collaborators: req.user._id }] });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Auto-start monitoring if project is live and not already monitored
    if (project.status === 'live' && project.containerId) {
      startMonitoring(project);
    }

    const status = getHealthStatus(project._id);

    // Update project's lastHealthScore in DB if changed
    if (status.lastScore !== project.lastHealthScore) {
      await Project.findByIdAndUpdate(project._id, { lastHealthScore: status.lastScore });
    }

    res.json(status);
  } catch (err) {
    console.error('[Health Route] Status error:', err.message);
    res.status(500).json({ message: 'Health check failed', error: err.message });
  }
});

// POST /api/health/:projectId/ack — acknowledge and clear alerts
router.post('/:projectId/ack', protect, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, $or: [{ owner: req.user._id }, { collaborators: req.user._id }] });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    acknowledgeAlert(project._id);
    await Project.findByIdAndUpdate(project._id, { lastHealthScore: 100 });

    res.json({ message: 'Alerts acknowledged', lastScore: 100 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to acknowledge alerts', error: err.message });
  }
});

module.exports = router;
