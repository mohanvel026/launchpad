const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  addCustomDomainToProject,
  provisionSSLForProject,
  getDomainInfo,
} = require('../controllers/domain.controller');

const router = express.Router();

// GET  /api/domains/:projectId          — get subdomain + custom domain info
router.get('/:projectId',               protect, getDomainInfo);

// POST /api/domains/:projectId/custom   — attach a custom domain
router.post('/:projectId/custom',       protect, addCustomDomainToProject);

// POST /api/domains/:projectId/ssl      — provision Let's Encrypt SSL cert
router.post('/:projectId/ssl',          protect, provisionSSLForProject);

module.exports = router;