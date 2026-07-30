const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  color: { type: String, default: '#6c5ce7' },
  icon: { type: String, default: '📁' },
  createdBy: { type: String },
  createdDate: { type: Date, default: Date.now },
  teamspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace' },
});

module.exports = mongoose.model('Project', projectSchema);
