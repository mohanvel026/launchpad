const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  getEnvVars, setEnvVar, deleteEnvVar
} = require('../controllers/env.controller');
const Project = require('../models/Project.model');
const path    = require('path');
const fs      = require('fs');

const router = express.Router();

// GET  /api/env/:projectId         — list all env var keys (values masked)
router.get('/:projectId',           protect, getEnvVars);

// POST /api/env/:projectId         — create or update an env var
router.post('/:projectId',          protect, setEnvVar);

// DELETE /api/env/:projectId/:key  — delete an env var
router.delete('/:projectId/:key',   protect, deleteEnvVar);

// GET /api/env/:projectId/ai-scan  — scan repo for missing env var references
router.get('/:projectId/ai-scan', protect, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const REPOS_DIR = path.join(__dirname, '../../repos');
    const repoPath  = path.join(REPOS_DIR, project._id.toString());
    if (!fs.existsSync(repoPath)) return res.json({ missingVars: [], message: 'Repository not cloned yet.' });

    // Get existing vars
    const EnvVar = require('../models/EnvVar.model');
    const existingVars = await EnvVar.find({ project: project._id }).select('key');
    const existingKeys = new Set(existingVars.map(e => e.key));

    // Scan repo files for process.env.* and import.meta.env.* references
    const detected = new Set();
    const scanDir = (dir, depth = 0) => {
      if (depth > 5) return;
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          if (['node_modules', '.git', 'dist', 'build', '.next'].includes(item)) continue;
          const full = path.join(dir, item);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) { scanDir(full, depth + 1); continue; }
          if (!/\.(js|ts|jsx|tsx|mjs|cjs|env\.example|env\.sample)$/.test(item)) continue;
          try {
            const content = fs.readFileSync(full, 'utf8').slice(0, 50000);
            // Match process.env.VAR_NAME and import.meta.env.VAR_NAME
            const matches = content.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/g);
            for (const m of matches) detected.add(m[1]);
            // Also match from .env.example KEY=value patterns
            if (item.includes('.env.example') || item.includes('.env.sample')) {
              const envLines = content.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=/gm);
              for (const m of envLines) detected.add(m[1]);
            }
          } catch {} 
        }
      } catch {}
    };
    scanDir(repoPath);

    // Filter to vars not already set + skip common non-secret ones
    const SKIP_VARS = new Set(['NODE_ENV', 'PORT', 'HOST', 'PATH', 'HOME', 'PWD', 'SHELL']);
    const missingVars = [...detected]
      .filter(v => !existingKeys.has(v) && !SKIP_VARS.has(v))
      .sort();

    res.json({ missingVars, totalDetected: detected.size, existing: existingKeys.size });
  } catch (err) {
    console.error('[Env AI Scan]', err.message);
    res.status(500).json({ message: 'Scan failed', error: err.message });
  }
});

module.exports = router;