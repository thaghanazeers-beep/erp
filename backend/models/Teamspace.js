const mongoose = require('mongoose');

// A saved database view (Notion-style): every member sees the same view
// config; editing a view updates it for the whole teamspace.
const viewSchema = new mongoose.Schema({
  id:   { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['table', 'board', 'list', 'gallery'], default: 'table' },
  filters: { type: mongoose.Schema.Types.Mixed, default: null }, // { conjunction, rules: [{ field, op, value }] }
  sorts:   { type: [{ key: String, dir: Number, _id: false }], default: [] },
  groupBy: { type: String, default: '' },
  hiddenColumns: { type: [String], default: [] },
}, { _id: false });

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
  // Superseded by per-view filters in `views`; kept for back-compat.
  defaultTaskFilters: { type: mongoose.Schema.Types.Mixed, default: null },
  // Saved task views (Notion-style shared database views)
  views: { type: [viewSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Teamspace', teamspaceSchema);
