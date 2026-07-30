const mongoose = require('mongoose');

const sprintSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  goal:        { type: String, default: '' },
  projectId:   { type: String },              // optional project scope
  status:      { type: String, enum: ['planned', 'active', 'completed'], default: 'planned' },
  startDate:   { type: Date },
  endDate:     { type: Date },
  createdBy:   { type: String },
  createdDate: { type: Date, default: Date.now },
  completedAt: { type: Date },
  teamspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace' },
});

module.exports = mongoose.model('Sprint', sprintSchema);
