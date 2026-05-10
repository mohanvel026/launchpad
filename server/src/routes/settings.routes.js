const express     = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  getProfile, updateProfile,
  getToken, getStats, deleteAccount,
} = require('../controllers/settings.controller');

const router = express.Router();

router.get('/profile',    protect, getProfile);
router.put('/profile',    protect, updateProfile);
router.get('/token',      protect, getToken);
router.get('/stats',      protect, getStats);
router.delete('/account', protect, deleteAccount);

module.exports = router;