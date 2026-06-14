const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  triggerDeploy, getDeployments, getDeployment,
  rollback, githubWebhook,
  cancelDeploy, stopProject, startProject, restartProject, getRecentActivity,
  triggerDeployHook, getDeployHooks, createDeployHook, deleteDeployHook,
  getWebhooks, createWebhook, deleteWebhook, getProjectBadge, updateDeploymentNotes
} = require('../controllers/deploy.controller');

const router = express.Router();

// GitHub calls this on every push — no auth, verified by signature
router.post('/webhook', githubWebhook);

// Public Incoming Deploy Hook Trigger
router.post('/hooks/:token', triggerDeployHook);

// Public SVG README Badge
router.get('/projects/:projectId/badge', getProjectBadge);

// GET recent activity across all user projects
router.get('/recent-activity',                    protect, getRecentActivity);

// Deploy Hooks Management
router.get('/:projectId/hooks',                   protect, getDeployHooks);
router.post('/:projectId/hooks',                  protect, createDeployHook);
router.delete('/:projectId/hooks/:hookId',        protect, deleteDeployHook);

// Outgoing Webhooks Management
router.get('/:projectId/webhooks',                protect, getWebhooks);
router.post('/:projectId/webhooks',               protect, createWebhook);
router.delete('/:projectId/webhooks/:webhookId',  protect, deleteWebhook);

// Manual deploy trigger
router.post('/:projectId',                        protect, triggerDeploy);

// Deployment history for a project
router.get('/:projectId',                         protect, getDeployments);

// Single deployment detail (includes logs + AI error summary)
router.get('/:projectId/:deploymentId',           protect, getDeployment);

// Update deployment release notes/comments
router.put('/:projectId/:deploymentId/notes',     protect, updateDeploymentNotes);

// Roll back to a previous successful deployment
router.post('/:projectId/rollback/:deploymentId', protect, rollback);

// Cancel a queued or in-progress deployment
router.post('/:projectId/cancel',                 protect, cancelDeploy);

// Container lifecycle controls
router.post('/:projectId/stop',                   protect, stopProject);
router.post('/:projectId/start',                  protect, startProject);
router.post('/:projectId/restart',                protect, restartProject);

module.exports = router;