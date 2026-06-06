const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const Project     = require('../models/Project.model');
const { scanForVulnerabilities, generateVulnFixPatch } = require('../services/vulnScanner.service');
const path        = require('path');

const router = express.Router();

const REPOS_DIR = path.join(__dirname, '../../repos');

// GET /api/vuln/:projectId — scan for CVEs
router.get('/:projectId', protect, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, $or: [{ owner: req.user._id }, { collaborators: req.user._id }] });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(REPOS_DIR, project._id.toString());
    const results = await scanForVulnerabilities(repoPath);

    // Persist summary to project
    await Project.findByIdAndUpdate(project._id, {
      lastVulnScanAt: new Date(),
      vulnSummary: results.summary,
    });

    res.json({ ...results, projectId: project._id });
  } catch (err) {
    console.error('[Vuln Route] Scan error:', err.message);
    res.status(500).json({ message: 'Vulnerability scan failed', error: err.message });
  }
});

// POST /api/vuln/:projectId/auto-fix — generate AI fix commands
router.post('/:projectId/auto-fix', protect, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, $or: [{ owner: req.user._id }, { collaborators: req.user._id }] });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(REPOS_DIR, project._id.toString());
    const vulns = await scanForVulnerabilities(repoPath);
    const fixPatch = await generateVulnFixPatch(vulns.packages, repoPath);

    res.json({ fixPatch, scannedPackages: vulns.packages.length });
  } catch (err) {
    console.error('[Vuln Route] Auto-fix error:', err.message);
    res.status(500).json({ message: 'Auto-fix generation failed', error: err.message });
  }
});

module.exports = router;
