/**
 * syncNotionSprints — link imported tasks to their sprints (CLI wrapper around
 * services/notionSync.syncSprints). Fetches every sprint page referenced by a
 * task, upserts the Sprint (by notionId, then by exact name) and sets
 * task.sprintId. The header "Sync Notion" button runs the same code.
 *
 * Usage:  node scripts/syncNotionSprints.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const { Client } = require('@notionhq/client');
const { syncSprints } = require('../services/notionSync');

const DRY = process.argv.includes('--dry-run');

(async () => {
  if (!process.env.NOTION_TOKEN) { console.error('NOTION_TOKEN missing in backend/.env'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  const r = await syncSprints(new Client({ auth: process.env.NOTION_TOKEN }), (m) => process.stdout.write(`\r  ${m}`.padEnd(60)), { dryRun: DRY });
  console.log(`\n\nSummary: ${r.sprints} sprints referenced, ${r.created} created, ${r.adopted} adopted by name, ${r.unreachable} unreachable, ${DRY ? 'no writes (dry run)' : `${r.linked} tasks newly linked`}`);
  await mongoose.disconnect();
})().catch(err => { console.error('FAILED:', err); process.exit(1); });
