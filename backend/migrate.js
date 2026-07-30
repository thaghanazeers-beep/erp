const mongoose = require('mongoose');
const { Task } = require('./models/Task');
const Project = require('./models/Project');
const Sprint = require('./models/Sprint');
const Teamspace = require('./models/Teamspace');

mongoose.connect('mongodb://localhost:27017/mayvel_task').then(async () => {
  const ts = await Teamspace.findOne();
  if (!ts) {
    console.log("No teamspace found.");
    process.exit(0);
  }
  
  const tsId = ts._id;
  const tRes = await Task.updateMany({ teamspaceId: { $exists: false } }, { $set: { teamspaceId: tsId } });
  const pRes = await Project.updateMany({ teamspaceId: { $exists: false } }, { $set: { teamspaceId: tsId } });
  const sRes = await Sprint.updateMany({ teamspaceId: { $exists: false } }, { $set: { teamspaceId: tsId } });
  
  console.log(`Migrated ${tRes.modifiedCount} tasks, ${pRes.modifiedCount} projects, ${sRes.modifiedCount} sprints to Teamspace ${ts.name}`);
  process.exit(0);
});
