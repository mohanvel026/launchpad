const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const { getProjectAnalytics, resetProjectAnalytics, getBuildTrends } = require('../controllers/analytics.controller');

const router = express.Router();

router.get('/:projectId',          protect, getProjectAnalytics);
router.delete('/:projectId/reset', protect, resetProjectAnalytics);

// GET /api/analytics/:projectId/build-trends
router.get('/:projectId/build-trends', protect, getBuildTrends);

module.exports = router;