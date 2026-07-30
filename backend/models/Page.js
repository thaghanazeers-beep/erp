const mongoose = require('mongoose');

const pageSchema = new mongoose.Schema({
  title:       { type: String, default: 'Untitled' },
  icon:        { type: String, default: '📄' },
  content:     { type: String, default: '' }, // Simple markdown or text block
  hasDatabase: { type: Boolean, default: false }, // Whether a task database is embedded
  createdBy:   { type: String },
  createdDate: { type: Date, default: Date.now },
  updatedDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Page', pageSchema);
