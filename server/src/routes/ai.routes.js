const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const { chatWithAI, suggestFix, optimizeConfig } = require('../controllers/ai.controller');

const router = express.Router();

// POST /api/ai/:projectId/chat        — chat with AI about your deployment
router.post('/:projectId/chat',        protect, chatWithAI);

// POST /api/ai/:projectId/suggest-fix — get AI fix for latest failed deploy
router.post('/:projectId/suggest-fix', protect, suggestFix);

// POST /api/ai/:projectId/optimize-config — get performance & Dockerfile optimization tips
router.post('/:projectId/optimize-config', protect, optimizeConfig);

module.exports = router;