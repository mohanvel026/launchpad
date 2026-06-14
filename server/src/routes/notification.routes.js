const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const {
  getNotifications,
  markAsRead,
  markAllAsRead
} = require('../controllers/notification.controller');

const router = express.Router();

router.get('/', protect, getNotifications);
router.post('/read-all', protect, markAllAsRead);
router.post('/:id/read', protect, markAsRead);

module.exports = router;
