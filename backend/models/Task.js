const mongoose = require('mongoose');

const propertyDefinitionSchema = new mongoose.Schema({
  id: String,
  name: String,
  type: { type: String, enum: ['text', 'number', 'date', 'select', 'multiSelect', 'checkbox', 'url', 'email', 'phone'] },
  options: [String],
});

const customPropertySchema = new mongoose.Schema({
  definitionId: String,
  value: mongoose.Schema.Types.Mixed,
});

const attachmentSchema = new mongoose.Schema({
  id: String,
  name: String,
  path: String,
  sizeBytes: Number,
  addedAt: Date,
});

const taskSchema = new mongoose.Schema({
  id:             { type: String, required: true, unique: true },
  notionId:       { type: String },
  title:          { type: String, required: true },
  description:    { type: String, default: '' },
  status:         { type: String, default: 'Not Yet Started' },
  priority:       { type: String, default: '' },
  assignee:       { type: String, default: '' },
  dueDate:        { type: Date },
  startDate:      { type: Date },
  createdDate:    { type: Date, default: Date.now },
  customProperties: [customPropertySchema],
  attachments:    [attachmentSchema],
  parentId:       { type: String },
  projectId:      { type: String },
  pageId:         { type: String }, // Links to the parent Page database
  sprintId:       { type: String },
  notionProjectId:{ type: String },
  notionSprintId: { type: String },
  estimatedHours: { type: Number, default: 0 },
  actualHours:    { type: Number, default: 0 },
  taskType:       { type: [String], default: [] },
  updatedBy:      { type: String },
  teamspaceId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace' },
  // child tasks are fetched by finding tasks with `parentId` === this task's id
});

// Indexes for the hot filter/sort paths on GET /api/tasks
taskSchema.index({ status: 1 });
taskSchema.index({ assignee: 1 });
taskSchema.index({ projectId: 1 });
taskSchema.index({ sprintId: 1 });
taskSchema.index({ pageId: 1 });
taskSchema.index({ parentId: 1 });
taskSchema.index({ teamspaceId: 1 });
taskSchema.index({ createdDate: -1 });

module.exports = {
  Task: mongoose.model('Task', taskSchema),
  PropertyDefinition: mongoose.model('PropertyDefinition', propertyDefinitionSchema)
};
