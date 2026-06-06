const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  triggerDeploy, getDeployments, getDeployment,
  rollback, githubWebhook, rollbackDeployment
} = require('../controllers/deploy.controller');

const router = express.Router();

// GitHub calls this on every push — no auth, verified by signature
router.post('/webhook', githubWebhook);

// Manual deploy trigger
router.post('/:projectId',                        protect, triggerDeploy);

// Deployment history for a project
router.get('/:projectId',                         protect, getDeployments);

// Single deployment detail (includes logs + AI error summary)
router.get('/:projectId/:deploymentId',           protect, getDeployment);

// Roll back to a previous successful deployment
router.post('/:projectId/rollback/:deploymentId', protect, rollback);

// POST /api/deploy/:id/rollback/:deploymentId — rollback to a specific deployment
router.post('/:id/rollback/:deploymentId', protect, rollbackDeployment);

module.exports = router;