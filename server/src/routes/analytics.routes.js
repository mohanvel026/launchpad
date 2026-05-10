const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const { getProjectAnalytics, resetProjectAnalytics } = require('../controllers/analytics.controller');

const router = express.Router();

router.get('/:projectId',          protect, getProjectAnalytics);
router.delete('/:projectId/reset', protect, resetProjectAnalytics);

module.exports = router;