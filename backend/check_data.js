const mongoose = require('mongoose');
const { Task } = require('./models/Task');
const Sprint = require('./models/Sprint');
mongoose.connect('mongodb://localhost:27017/mayvel_task').then(async () => {
  const tasks = await Task.find({});
  const sprints = await Sprint.find({});
  console.log('Total tasks:', tasks.length);
  console.log('Total sprints:', sprints.length);
  if (tasks.length > 0) {
    console.log('Sample task teamspaceId:', tasks[0].teamspaceId);
  }
  process.exit(0);
});
