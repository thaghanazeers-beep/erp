const mongoose = require('mongoose');

// Booking categories every project starts with (the legacy ERP's default "tasks").
const DEFAULT_CATEGORIES = ['Development', 'Analysis', 'Testing/QA', 'Implementation', 'Project management', 'UI/UX/Frontend', 'Meetings'];

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  color: { type: String, default: '#6c5ce7' },
  icon: { type: String, default: '📁' },
  createdBy: { type: String },
  createdDate: { type: Date, default: Date.now },
  teamspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace' },

  // ── ERP fields (timesheets, Profit & Loss) ──
  client:     { type: String, default: '' },                                   // project owner / customer
  type:       { type: String, enum: ['Product', 'Service', 'Others'], default: 'Others' },
  status:     { type: String, enum: ['Active', 'In Progress', 'InActive', 'Completed'], default: 'Active' },
  startDate:  { type: String, default: '' },                                   // 'YYYY-MM-DD'
  endDate:    { type: String, default: '' },
  managerId:  { type: String, default: '' },                                   // User._id of the project manager
  memberIds:  { type: [String], default: [] },                                 // who may book time to it
  budget:     { type: Number, default: 0 },                                    // manual budget when no approved requests exist
  categories: { type: [String], default: () => [...DEFAULT_CATEGORIES] },      // booking categories for timesheet rows
  billable:   { type: Boolean, default: true },
});

const Project = mongoose.model('Project', projectSchema);
Project.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
module.exports = Project;
