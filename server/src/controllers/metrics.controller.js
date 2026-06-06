const Project = require('../models/Project.model');
const { getCachedStats, getMetricHistory } = require('../services/metrics.service');

// GET /api/metrics/:projectId — current live stats
const getLiveMetrics = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    }).select('containerId status subdomain');

    if (!project)            return res.status(404).json({ message: 'Project not found' });
    if (!project.containerId) return res.json({ status: 'no container', cpu: 0, memMB: 0 });

    const stats = await getCachedStats(project.containerId);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/metrics/:projectId/history — last 60 snapshots (10 minutes)
const getMetricsHistory = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    }).select('_id');

    if (!project) return res.status(404).json({ message: 'Project not found' });

    const history = await getMetricHistory(project._id.toString());
    res.json({ history });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/metrics/:projectId/cost-estimate — AI cost estimation from metrics history
const getCostEstimate = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    }).select('cpuLimit ramLimitMB containerId');

    if (!project) return res.status(404).json({ message: 'Project not found' });

    const { estimateMonthlyCost } = require('../services/ai.service');
    const { getMetricHistory } = require('../services/metrics.service');
    const history = await getMetricHistory(project._id.toString());

    const estimate = await estimateMonthlyCost(history || [], project);
    res.json(estimate);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getLiveMetrics, getMetricsHistory, getCostEstimate };