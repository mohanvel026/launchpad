const express = require('express');
const { protect, getUserWithToken } = require('../middleware/auth.middleware');
const {
  getProjects, createProject, getProject,
  deleteProject, getUserRepos, analyzeRepo, registerWebhook, updateProject,
  clearProjectStuckBuild, resizeResourceLimits, deploymentReadinessCheck, syncProjectStatus
} = require('../controllers/project.controller');

const router = express.Router();

// GET  /api/projects/repos        — list user's GitHub repos for the picker
router.get('/repos',              getUserWithToken, getUserRepos);

// POST /api/projects/repos/analyze — AI-powered repo analysis for autonomous deploy
router.post('/repos/analyze',     getUserWithToken, analyzeRepo);

// GET  /api/projects         — all projects the user owns or collaborates on
router.get('/',              protect,          getProjects);

// POST /api/projects         — create a new project
router.post('/',             getUserWithToken,  createProject);

// GET  /api/projects/:id
router.get('/:id',           protect,          getProject);

// PATCH /api/projects/:id
router.patch('/:id',         protect,          updateProject);

// DELETE /api/projects/:id
router.delete('/:id',        protect,          deleteProject);

// POST /api/projects/:id/webhook — register GitHub push webhook
router.post('/:id/webhook',  getUserWithToken,  registerWebhook);

// POST /api/projects/:id/clear-stuck — clear stuck build statuses
router.post('/:id/clear-stuck', protect,        clearProjectStuckBuild);

// POST /api/projects/:id/resize-limits — zero-downtime hot-swap SRE container resource sizing bounds
router.post('/:id/resize-limits', protect,      resizeResourceLimits);

// POST /api/projects/:id/readiness — AI deployment readiness check
router.post('/:id/readiness', protect, deploymentReadinessCheck);

// POST /api/projects/:id/sync-status — repair project status from deployment history
router.post('/:id/sync-status', protect, syncProjectStatus);

module.exports = router;