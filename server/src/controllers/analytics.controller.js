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
    res.json({ analytics, project: { name: project.name, status: project.status, subdomain: project.subdomain } });
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

module.exports = { getProjectAnalytics, resetProjectAnalytics };