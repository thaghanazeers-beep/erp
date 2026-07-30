const mongoose = require('mongoose');

const conditionSchema = new mongoose.Schema({
  field: { type: String, required: true }, // status, assignee, project, title, dueDate
  operator: { type: String, required: true }, // equals, not_equals, contains, is_empty, is_not_empty, before, after
  value: { type: String, default: '' },
}, { _id: false });

const actionSchema = new mongoose.Schema({
  type: { type: String, required: true },
  // change_status, assign_to, move_to_project, create_subtask,
  // set_due_date, add_label, send_notification, duplicate_task
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  order: { type: Number, default: 0 },
}, { _id: false });

const triggerSchema = new mongoose.Schema({
  type: { type: String, required: true },
  // task_created, status_changed, assignee_changed, due_date_approaching,
  // task_moved_to_project, task_updated, schedule
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const executionLogSchema = new mongoose.Schema({
  workflowId: { type: String },
  taskId: { type: String },
  taskTitle: { type: String },
  trigger: { type: String },
  actionsExecuted: [{ type: String }],
  status: { type: String, enum: ['success', 'failed', 'skipped'], default: 'success' },
  error: { type: String },
  executedAt: { type: Date, default: Date.now },
});

const workflowSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: '⚡' },
  color: { type: String, default: '#6c5ce7' },
  enabled: { type: Boolean, default: true },
  trigger: triggerSchema,
  conditions: [conditionSchema],
  actions: [actionSchema],
  executionCount: { type: Number, default: 0 },
  lastExecuted: { type: Date },
  createdBy: { type: String },
  createdDate: { type: Date, default: Date.now },
});

const Workflow = mongoose.model('Workflow', workflowSchema);
const WorkflowLog = mongoose.model('WorkflowLog', executionLogSchema);

module.exports = { Workflow, WorkflowLog };
