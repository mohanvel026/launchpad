const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  getEnvVars, setEnvVar, deleteEnvVar
} = require('../controllers/env.controller');

const router = express.Router();

// GET  /api/env/:projectId         — list all env var keys (values masked)
router.get('/:projectId',           protect, getEnvVars);

// POST /api/env/:projectId         — create or update an env var
router.post('/:projectId',          protect, setEnvVar);

// DELETE /api/env/:projectId/:key  — delete an env var
router.delete('/:projectId/:key',   protect, deleteEnvVar);

module.exports = router;