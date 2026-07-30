require('dotenv').config({ path: '../.env' });
const { Client } = require('@notionhq/client');
const mongoose = require('mongoose');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/mayvel_task_management';
if (!NOTION_TOKEN) { console.error('Missing NOTION_TOKEN in backend/.env'); process.exit(1); }

const notion = new Client({ auth: NOTION_TOKEN });

const taskSchema = new mongoose.Schema({
  notionProjectId: { type: String },
  projectId: { type: String }
}, { strict: false });

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  notionId: { type: String },
});

const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);

async function extractPageTitle(pageId) {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    // Find the title property
    const props = page.properties;
    for (const key in props) {
      if (props[key].type === 'title') {
        return props[key].title.map(t => t.plain_text).join('');
      }
    }
    return `Project ${pageId.substring(0, 8)}`;
  } catch (err) {
    console.error(`Error fetching page ${pageId}:`, err.message);
    return `Project ${pageId.substring(0, 8)}`;
  }
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const distinctNotionProjects = await Task.distinct('notionProjectId', { notionProjectId: { $ne: null } });
  console.log(`Found ${distinctNotionProjects.length} distinct Notion projects.`);

  for (const notionId of distinctNotionProjects) {
    let project = await Project.findOne({ notionId });
    if (!project) {
      console.log(`Fetching Notion title for project ${notionId}...`);
      const title = await extractPageTitle(notionId);
      project = new Project({ name: title, notionId });
      await project.save();
      console.log(`Created Project: ${title}`);
    } else {
      console.log(`Project already exists: ${project.name}`);
    }

    // Link tasks to this project
    const result = await Task.updateMany(
      { notionProjectId: notionId, projectId: { $exists: false } },
      { $set: { projectId: project._id.toString() } }
    );
    // Also update tasks where projectId is null or empty
    const result2 = await Task.updateMany(
      { notionProjectId: notionId, projectId: { $in: [null, ""] } },
      { $set: { projectId: project._id.toString() } }
    );
    console.log(`Linked ${result.modifiedCount + result2.modifiedCount} tasks to project ${project.name}`);
  }

  await mongoose.disconnect();
  console.log('Done!');
}

main().catch(console.error);
