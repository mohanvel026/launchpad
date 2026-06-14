const Project = require('../models/Project.model');
const { getAnalytics, resetAnalytics } = require('../services/analytics.service');

// GET /api/analytics/:projectId
const getProjectAnalytics = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const analytics = await getAnalytics(project._id.toString());

    // ── Compute real uptime from deployment history ──────────────────────────
    let uptimePercent = '100%';
    try {
      const Deployment = require('../models/Deployment.model');
      const allDeploys = await Deployment.find({ project: project._id })
        .sort({ createdAt: 1 })
        .select('status createdAt duration');

      if (allDeploys.length > 0) {
        const total = allDeploys.length;
        const successful = allDeploys.filter(d => d.status === 'success').length;
        const pct = Math.round((successful / total) * 100);
        uptimePercent = `${pct}%`;
      }
    } catch {}

    res.json({
      analytics: { ...analytics, uptime: uptimePercent },
      project: { name: project.name, status: project.status, subdomain: project.subdomain }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/analytics/:projectId/reset
const resetProjectAnalytics = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    await resetAnalytics(project._id.toString());
    res.json({ message: 'Analytics reset' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/analytics/:projectId/build-trends
const getBuildTrends = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const Deployment = require('../models/Deployment.model');
    const { analyzeBuildTrends } = require('../services/ai.service');

    const deployments = await Deployment.find({ project: project._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('status duration createdAt branch commitMessage isAutoHeal');

    const trends = await analyzeBuildTrends(deployments);
    res.json({ ...trends, history: deployments.slice(0, 10).reverse() });
  } catch (err) {
    console.error('[BuildTrends]', err.message);
    res.status(500).json({ message: 'Failed to get build trends', error: err.message });
  }
};

module.exports = { getProjectAnalytics, resetProjectAnalytics, getBuildTrends };