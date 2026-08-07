const mongoose = require('mongoose');

const teamspaceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: '🏢' },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  members: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['Admin', 'Member', 'Viewer'], default: 'Member' }
  }],
  isPersonal: { type: Boolean, default: false },
  // Task filters an Admin/owner saved as the team-wide default ("Save for
  // everyone") — applied for members who have no filters of their own.
  defaultTaskFilters: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Teamspace', teamspaceSchema);
