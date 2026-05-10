const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  inviteCollaborator,
  removeCollaborator,
  getCollaborators,
} = require('../controllers/team.controller');

const router = express.Router();

// GET    /api/team/:projectId              — list owner + collaborators
router.get('/:projectId',                  protect, getCollaborators);

// POST   /api/team/:projectId/invite       — invite by GitHub username
router.post('/:projectId/invite',          protect, inviteCollaborator);

// DELETE /api/team/:projectId/remove/:userId
router.delete('/:projectId/remove/:userId', protect, removeCollaborator);

module.exports = router;