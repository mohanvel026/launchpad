const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  triggerDeploy, getDeployments, getDeployment,
  rollback, githubWebhook,
  cancelDeploy, stopProject, startProject, restartProject, getRecentActivity
} = require('../controllers/deploy.controller');

const router = express.Router();

// GitHub calls this on every push — no auth, verified by signature
router.post('/webhook', githubWebhook);

// GET recent activity across all user projects
router.get('/recent-activity',                    protect, getRecentActivity);

// Manual deploy trigger
router.post('/:projectId',                        protect, triggerDeploy);

// Deployment history for a project
router.get('/:projectId',                         protect, getDeployments);

// Single deployment detail (includes logs + AI error summary)
router.get('/:projectId/:deploymentId',           protect, getDeployment);

// Roll back to a previous successful deployment
router.post('/:projectId/rollback/:deploymentId', protect, rollback);

// Cancel a queued or in-progress deployment
router.post('/:projectId/cancel',                 protect, cancelDeploy);

// Container lifecycle controls
router.post('/:projectId/stop',                   protect, stopProject);
router.post('/:projectId/start',                  protect, startProject);
router.post('/:projectId/restart',                protect, restartProject);

module.exports = router;