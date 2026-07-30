const mongoose = require('mongoose');

const orgNodeSchema = new mongoose.Schema({
  id:         { type: String, required: true },
  name:       { type: String, required: true },
  orgRole:    { type: String, default: 'Member' },
  department: { type: String, default: '' },
  memberId:   { type: String, default: null },   // links to User._id
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  w: { type: Number, default: 160 },
  h: { type: Number, default: 72 },
}, { _id: false });

const orgEdgeSchema = new mongoose.Schema({
  id:   { type: String, required: true },
  from: { type: String, required: true },
  to:   { type: String, required: true },
}, { _id: false });

const orgChartSchema = new mongoose.Schema({
  teamspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', default: null },
  nodes:       [orgNodeSchema],
  edges:       [orgEdgeSchema],
  updatedAt:   { type: Date, default: Date.now },
  updatedBy:   { type: String, default: '' },
}, { timestamps: true });

// One chart per teamspace (or one global if teamspaceId is null)
orgChartSchema.index({ teamspaceId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('OrgChart', orgChartSchema);
