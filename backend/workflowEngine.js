/**
 * Workflow Execution Engine
 * Evaluates triggers, checks conditions, and executes actions on tasks.
 */

const { Workflow, WorkflowLog } = require('./models/Workflow');
const { Task } = require('./models/Task');

class WorkflowEngine {
  constructor() {
    this.actionHandlers = {
      change_status: this._actionChangeStatus.bind(this),
      assign_to: this._actionAssignTo.bind(this),
      move_to_project: this._actionMoveToProject.bind(this),
      create_subtask: this._actionCreateSubtask.bind(this),
      set_due_date: this._actionSetDueDate.bind(this),
      add_label: this._actionAddLabel.bind(this),
      send_notification: this._actionSendNotification.bind(this),
      duplicate_task: this._actionDuplicateTask.bind(this),
    };
  }

  async fire(triggerType, task, context = {}) {
    try {
      const workflows = await Workflow.find({ enabled: true, 'trigger.type': triggerType });
      for (const workflow of workflows) {
        try {
          if (!this._matchTriggerConfig(workflow.trigger, task, context)) continue;
          if (!this._evaluateConditions(workflow.conditions, task)) continue;
          const actionsExecuted = await this._executeActions(workflow.actions, task);
          await WorkflowLog.create({
            workflowId: workflow._id.toString(), taskId: task.id, taskTitle: task.title,
            trigger: triggerType, actionsExecuted, status: 'success',
          });
          await Workflow.findByIdAndUpdate(workflow._id, { $inc: { executionCount: 1 }, lastExecuted: new Date() });
          console.log(`[Workflow] ✓ "${workflow.name}" executed on "${task.title}"`);
        } catch (err) {
          console.error(`[Workflow] ✗ "${workflow.name}" failed:`, err.message);
          await WorkflowLog.create({
            workflowId: workflow._id.toString(), taskId: task.id, taskTitle: task.title,
            trigger: triggerType, actionsExecuted: [], status: 'failed', error: err.message,
          });
        }
      }
    } catch (err) { console.error('[WorkflowEngine] Fatal error:', err); }
  }

  _matchTriggerConfig(trigger, task, context) {
    const cfg = trigger.config || {};
    switch (trigger.type) {
      case 'status_changed':
        if (cfg.fromStatus && cfg.fromStatus !== context.fromStatus) return false;
        if (cfg.toStatus && cfg.toStatus !== context.toStatus) return false;
        return true;
      case 'task_moved_to_project':
        if (cfg.projectId && cfg.projectId !== task.projectId) return false;
        return true;
      case 'assignee_changed':
        return true;
      case 'due_date_approaching':
        if (!task.dueDate) return false;
        const daysLeft = Math.ceil((new Date(task.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
        return daysLeft <= (cfg.daysBefore || 1) && daysLeft >= 0;
      case 'task_created':
      case 'task_updated':
        return true;
      default:
        return true;
    }
  }

  _evaluateConditions(conditions, task) {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every(cond => {
      const fieldValue = this._getFieldValue(task, cond.field);
      switch (cond.operator) {
        case 'equals': return fieldValue === cond.value;
        case 'not_equals': return fieldValue !== cond.value;
        case 'contains': return String(fieldValue || '').toLowerCase().includes(String(cond.value || '').toLowerCase());
        case 'not_contains': return !String(fieldValue || '').toLowerCase().includes(String(cond.value || '').toLowerCase());
        case 'is_empty': return !fieldValue || fieldValue === '';
        case 'is_not_empty': return fieldValue && fieldValue !== '';
        case 'before': return fieldValue && new Date(fieldValue) < new Date(cond.value);
        case 'after': return fieldValue && new Date(fieldValue) > new Date(cond.value);
        default: return true;
      }
    });
  }

  _getFieldValue(task, field) {
    switch (field) {
      case 'status': return task.status;
      case 'assignee': return task.assignee;
      case 'project': return task.projectId;
      case 'title': return task.title;
      case 'dueDate': return task.dueDate;
      case 'description': return task.description;
      case 'estimatedHours': return task.estimatedHours;
      case 'actualHours': return task.actualHours;
      default: return task[field];
    }
  }

  async _executeActions(actions, task) {
    const sorted = [...actions].sort((a, b) => (a.order || 0) - (b.order || 0));
    const executed = [];
    for (const action of sorted) {
      const handler = this.actionHandlers[action.type];
      if (handler) { await handler(task, action.config || {}); executed.push(action.type); }
    }
    return executed;
  }

  async _actionChangeStatus(task, config) {
    if (config.status) await Task.findOneAndUpdate({ id: task.id }, { status: config.status });
  }

  async _actionAssignTo(task, config) {
    if (config.assignee) await Task.findOneAndUpdate({ id: task.id }, { assignee: config.assignee });
  }

  async _actionMoveToProject(task, config) {
    if (config.projectId) await Task.findOneAndUpdate({ id: task.id }, { projectId: config.projectId });
  }

  async _actionCreateSubtask(task, config) {
    const subtask = new Task({
      id: `task_auto_${Date.now()}`, title: config.title || 'Auto-created subtask',
      description: config.description || '', status: config.status || 'Not Yet Started',
      assignee: config.assignee || task.assignee || '', parentId: task.id,
      projectId: task.projectId, createdDate: new Date(), customProperties: [], attachments: [],
    });
    await subtask.save();
  }

  async _actionSetDueDate(task, config) {
    let dueDate;
    if (config.mode === 'relative') { dueDate = new Date(); dueDate.setDate(dueDate.getDate() + (config.daysFromNow || 7)); }
    else if (config.date) { dueDate = new Date(config.date); }
    if (dueDate) await Task.findOneAndUpdate({ id: task.id }, { dueDate });
  }

  async _actionAddLabel(task, config) {
    if (config.label) await Task.findOneAndUpdate({ id: task.id }, { $addToSet: { customProperties: { definitionId: 'label', value: config.label } } });
  }

  async _actionSendNotification(task, config) {
    // Create real targeted notifications in the database
    const Notification = require('./models/Notification');
    const User = require('./models/User');

    let targetUsers = [];
    if (config.sendTo === 'assignee' && task.assignee) {
      targetUsers = [task.assignee];
    } else if (config.sendTo === 'admins') {
      const admins = await User.find({ role: 'Admin' }, 'name');
      targetUsers = admins.map(a => a.name);
    } else if (config.sendTo === 'specific' && config.targetUser) {
      targetUsers = [config.targetUser];
    } else if (config.sendTo === 'all') {
      const allUsers = await User.find({}, 'name');
      targetUsers = allUsers.map(u => u.name);
    }

    const msg = (config.message || 'Task "{task}" updated')
      .replace('{task}', task.title)
      .replace('{assignee}', task.assignee || 'Unassigned')
      .replace('{status}', task.status || '');

    for (const userName of targetUsers) {
      await Notification.create({
        type: 'workflow_notification', title: config.title || 'Workflow Alert',
        message: msg, taskId: task.id, taskTitle: task.title,
        userId: userName, actorName: 'Workflow',
      });
    }
    console.log(`[Workflow Notification] Sent to [${targetUsers.join(', ')}]: ${msg}`);
  }

  async _actionDuplicateTask(task, config) {
    const dupe = new Task({
      id: `task_dup_${Date.now()}`,
      title: config.titlePrefix ? `${config.titlePrefix} ${task.title}` : `Copy of ${task.title}`,
      description: task.description, status: config.status || 'Not Yet Started',
      assignee: config.assignee || task.assignee || '', projectId: config.projectId || task.projectId,
      dueDate: task.dueDate, createdDate: new Date(), customProperties: [], attachments: [],
    });
    await dupe.save();
  }

  async runScheduledChecks() {
    const workflows = await Workflow.find({ enabled: true, 'trigger.type': 'due_date_approaching' });
    if (workflows.length === 0) return;
    const tasks = await Task.find({ dueDate: { $ne: null }, status: { $nin: ['Completed', 'Rejected'] } });
    for (const task of tasks) { await this.fire('due_date_approaching', task); }
  }
}

module.exports = new WorkflowEngine();
