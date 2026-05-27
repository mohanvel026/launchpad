const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  addCustomDomainToProject,
  provisionSSLForProject,
  getDomainInfo,
  verifyCustomDomainDNS,
  removeCustomDomainFromProject
} = require('../controllers/domain.controller');

const router = express.Router();

// GET  /api/domains/:projectId          — get subdomain + custom domain info
router.get('/:projectId',               protect, getDomainInfo);

// GET  /api/domains/:projectId/verify   — check live DNS resolution for custom domain
router.get('/:projectId/verify',        protect, verifyCustomDomainDNS);

// POST /api/domains/:projectId/custom   — attach a custom domain
router.post('/:projectId/custom',       protect, addCustomDomainToProject);

// DELETE /api/domains/:projectId/custom — remove custom domain and clean proxy
router.delete('/:projectId/custom',     protect, removeCustomDomainFromProject);

// POST /api/domains/:projectId/ssl      — provision Let's Encrypt SSL cert
router.post('/:projectId/ssl',          protect, provisionSSLForProject);

module.exports = router;