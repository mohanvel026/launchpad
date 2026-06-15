const express = require('express');
const { protect, getUserWithToken } = require('../middleware/auth.middleware');
const {
  getProjects, createProject, getProject,
  deleteProject, getUserRepos, analyzeRepo, registerWebhook, updateProject,
  clearProjectStuckBuild, resizeResourceLimits, deploymentReadinessCheck, syncProjectStatus,
  checkSubdomainAvailability, getProjectDockerfile, saveProjectDockerfile, lintProjectDockerfile,
  getProjectVolumeDetails, clearProjectVolume, executeContainerCommand
} = require('../controllers/project.controller');

const router = express.Router();

// GET  /api/projects/repos        — list user's GitHub repos for the picker
router.get('/repos',              getUserWithToken, getUserRepos);

// GET  /api/projects/check-subdomain — verify if subdomain is available
router.get('/check-subdomain',     getUserWithToken, checkSubdomainAvailability);

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

// GET  /api/projects/:id/dockerfile — get custom Dockerfile or generate default
router.get('/:id/dockerfile', protect, getProjectDockerfile);

// POST /api/projects/:id/dockerfile — save custom Dockerfile
router.post('/:id/dockerfile', protect, saveProjectDockerfile);

// POST /api/projects/:id/dockerfile/lint — lint Dockerfile code
router.post('/:id/dockerfile/lint', protect, lintProjectDockerfile);

// POST /api/projects/:id/readme — trigger AI README and Architecture generator
const { generateDocs, commitReadme } = require('../controllers/ai.controller');
router.post('/:id/readme', protect, generateDocs);
router.post('/:id/readme/commit', protect, commitReadme);

// POST /api/projects/:id/sync-status — repair project status from deployment history
router.post('/:id/sync-status', protect, syncProjectStatus);

// Volume management routes
router.get('/:id/volume/files', protect, getProjectVolumeDetails);
router.post('/:id/volume/clear', protect, clearProjectVolume);

// Container interactive terminal command executor route
router.post('/:id/exec', protect, executeContainerCommand);

module.exports = router;