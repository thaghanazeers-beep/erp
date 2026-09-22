/**
 * Notion → MongoDB task sync (CLI wrapper around services/notionSync).
 * Non-destructive: upserts by `notion_<pageId>`; tasks created in Mayvel are
 * never touched. The same code runs behind the header "Sync Notion" button.
 *
 * Usage: node scripts/importNotion.js [--with-sprints]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const { runNotionSync } = require('../services/notionSync');
const { Task } = require('../models/Task');

if (!process.env.NOTION_TOKEN || !process.env.NOTION_TASKS_DB) {
  console.error('Missing NOTION_TOKEN or NOTION_TASKS_DB in backend/.env');
  process.exit(1);
}

(async () => {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mayvel_task_management');
  const phases = process.argv.includes('--with-sprints') ? ['tasks', 'sprints'] : ['tasks'];
  const result = await runNotionSync({ startedBy: 'cli', phases, log: (m) => process.stdout.write(`\r  ${m}`.padEnd(70)) });
  console.log(`\n\n✅ Sync complete! Upserted: ${result.tasks.upserted}, Skipped: ${result.tasks.skipped}`);
  if (result.sprints) console.log(`   Sprints: ${result.sprints.created} created, ${result.sprints.adopted} adopted, ${result.sprints.unreachable} unreachable, ${result.sprints.linked} tasks newly linked`);
  const counts = await Task.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  console.log('\n📊 Task breakdown by status:');
  for (const c of counts) console.log(`   ${c._id}: ${c.count}`);
  await mongoose.disconnect();
  console.log('\n🔌 Disconnected. Done!');
})().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
