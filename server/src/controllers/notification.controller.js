const Notification = require('../models/Notification.model');

// GET /api/notifications
const getNotifications = async (req, res) => {
  try {
    const list = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('project', 'name')
      .populate('deployment', 'status commitMessage');
    
    res.json({ notifications: list });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/notifications/:id/read
const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true },
      { returnDocument: 'after' }
    );
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ notification });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/notifications/read-all
const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, read: false },
      { read: true }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
};
