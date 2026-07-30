const mongoose = require('mongoose');

// Authentication is Microsoft SSO only — no passwords are stored.
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  azureOid: { type: String, index: true }, // Microsoft Entra ID object id
  role: { type: String, enum: ['Admin', 'Team Owner', 'Member'], default: 'Member' },
  active: { type: Boolean, default: true }, // deactivate instead of hard-delete
  profilePictureUrl: { type: String },
  lastLoginAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
