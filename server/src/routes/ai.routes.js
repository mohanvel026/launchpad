const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  chatWithAI,
  suggestFix,
  optimizeConfig,
  discoverEnv,
  inspectLogs,
  optimizeDbQueries,
  predictResources,
  generateDocs,
  auditSecurity
} = require('../controllers/ai.controller');

const router = express.Router();

// POST /api/ai/:projectId/chat        — chat with AI about your deployment
router.post('/:projectId/chat',        protect, chatWithAI);

// POST /api/ai/:projectId/suggest-fix — get AI fix for latest failed deploy
router.post('/:projectId/suggest-fix', protect, suggestFix);

// POST /api/ai/:projectId/optimize-config — get performance & Dockerfile optimization tips
router.post('/:projectId/optimize-config', protect, optimizeConfig);

// POST /api/ai/:projectId/discover-env — auto-detect expected environment variables in source code
router.post('/:projectId/discover-env', protect, discoverEnv);

// POST /api/ai/:projectId/inspect-logs — inspect live container logs for silent health anomalies
router.post('/:projectId/inspect-logs', protect, inspectLogs);

// POST /api/ai/:projectId/optimize-queries — audit database queries and suggest indexes/improvements
router.post('/:projectId/optimize-queries', protect, optimizeDbQueries);

// POST /api/ai/:projectId/predict-resources — predict memory limit, CPU, and cache allocations
router.post('/:projectId/predict-resources', protect, predictResources);

// POST /api/ai/:projectId/generate-docs — auto-generate README and full REST API endpoint docs
router.post('/:projectId/generate-docs', protect, generateDocs);

// POST /api/ai/:projectId/audit-security — scan dependencies and source patterns for CVEs and vulnerabilities
router.post('/:projectId/audit-security', protect, auditSecurity);

module.exports = router;