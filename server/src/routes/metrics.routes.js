const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const { getLiveMetrics, getMetricsHistory } = require('../controllers/metrics.controller');

const router = express.Router();

// GET /api/metrics/:projectId          — live CPU/RAM snapshot
router.get('/:projectId',          protect, getLiveMetrics);

// GET /api/metrics/:projectId/history  — last 10 minutes of history
router.get('/:projectId/history',  protect, getMetricsHistory);

module.exports = router;