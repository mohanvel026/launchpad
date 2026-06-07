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

// POST /api/vuln/:projectId/apply-fix — execute upgraded dependency patches and redeploy
router.post('/:projectId/apply-fix', protect, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(REPOS_DIR, project._id.toString());
    const fs = require('fs');
    if (!fs.existsSync(repoPath)) {
      return res.status(400).json({ message: 'Repository not cloned yet. Deploy first.' });
    }

    // Scan dependencies and generate patches on the fly to guarantee safety (prevent shell injection)
    const vulns = await scanForVulnerabilities(repoPath);
    const fixPatch = await generateVulnFixPatch(vulns.packages, repoPath);

    if (!fixPatch.patchCommands || fixPatch.patchCommands.length === 0) {
      return res.status(400).json({ message: 'No secure patch commands generated for this project.' });
    }

    // Execute secure package upgrade commands
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    const logs = [];
    logs.push(`🛡️ Starting SRE dependency security upgrade for ${project.name}...`);

    for (const cmd of fixPatch.patchCommands) {
      // Security guard: only allow safe package installer commands
      if (!cmd.startsWith('npm install ') && !cmd.startsWith('yarn add ')) {
        logs.push(`⚠️ Skipping unauthorized command: "${cmd}"`);
        continue;
      }

      logs.push(`⚡ Executing: ${cmd}`);
      try {
        const { stdout, stderr } = await execPromise(cmd, { cwd: repoPath, timeout: 60000 });
        if (stdout) logs.push(stdout);
        if (stderr) logs.push(stderr);
      } catch (execErr) {
        logs.push(`❌ Command failed: ${execErr.message}`);
        return res.status(500).json({ message: `Dependency upgrade failed on command: ${cmd}`, logs });
      }
    }

    // Commit changes to local repository branch
    try {
      await execPromise('git add package.json package-lock.json yarn.lock || true', { cwd: repoPath });
      await execPromise('git commit -m "security(SRE): auto-upgrade vulnerable dependencies" || true', { cwd: repoPath });
      logs.push('✅ Package upgrades committed successfully to local git branch.');
    } catch (gitErr) {
      logs.push(`ℹ️ Git commit skipped: ${gitErr.message}`);
    }

    // Automatically trigger a fresh cache-bypassed rebuild
    const Deployment = require('../models/Deployment.model');
    const buildQueue = require('../workers/build.worker');
    const { emitProjectUpdate } = require('../sockets/logs.socket');

    const deployment = await Deployment.create({
      project: project._id,
      status: 'queued',
      commitSha: 'Security Patch',
      commitMessage: 'Security Patch (Auto-Upgrade Dependencies)',
      commitAuthor: 'LaunchLive SRE',
      startedAt: new Date(),
    });

    await Project.findByIdAndUpdate(project._id, { status: 'building' });

    // Send instant real-time socket update to client
    const updatedDeployments = await Deployment.find({ project: project._id }).sort({ createdAt: -1 }).limit(10);
    emitProjectUpdate(project._id.toString(), { project: { ...project.toObject(), status: 'building' }, deployments: updatedDeployments });

    // Queue Bull job with forceRebuild: true to ignore Docker layer caches
    await buildQueue.add(
      { deploymentId: deployment._id.toString(), projectId: project._id.toString(), forceRebuild: true },
      { attempts: 1, removeOnComplete: 50, removeOnFail: 50 }
    );

    res.json({ success: true, logs, deployment });
  } catch (err) {
    console.error('[Vuln Route] Apply fix error:', err.message);
    res.status(500).json({ message: 'Vulnerability patching failed', error: err.message });
  }
});

module.exports = router;
