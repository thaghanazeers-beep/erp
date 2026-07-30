const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  type: { type: String, required: true }, // task_created, task_assigned, status_changed, task_completed, task_rejected, review_requested
  title: { type: String, required: true },
  message: { type: String, required: true },
  taskId: { type: String },
  taskTitle: { type: String },
  userId: { type: String }, // recipient user ID (empty = broadcast to all)
  actorName: { type: String }, // who triggered the notification
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Auto-expire notifications after 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
// Hot path: per-user unread polling
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
