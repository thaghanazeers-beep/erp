/**
 * syncNotionSprints — link imported tasks to their sprints.
 *
 * The Notion task importer stored each task's sprint RELATION as
 * `notionSprintId`, but never created/linked the actual Sprint docs.
 * This script:
 *   1. collects every distinct notionSprintId across tasks
 *   2. fetches each sprint page from Notion (name, dates, status)
 *   3. upserts a Sprint doc (matched by notionId, then by exact name so
 *      manually created sprints get adopted instead of duplicated)
 *   4. sets task.sprintId for every task in that sprint
 *
 * Usage:  node scripts/syncNotionSprints.js [--dry-run]
 * Env:    NOTION_TOKEN (backend/.env), MONGODB_URI
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const { Client } = require('@notionhq/client');
const Sprint = require('../models/Sprint');
const { Task } = require('../models/Task');

const DRY = process.argv.includes('--dry-run');

const mapStatus = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'active' || v === 'in progress' || v === 'current') return 'active';
  if (v === 'completed' || v === 'done' || v === 'past') return 'completed';
  return 'planned';
};

(async () => {
  if (!process.env.NOTION_TOKEN) { console.error('NOTION_TOKEN missing in backend/.env'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  const sprintIds = (await Task.distinct('notionSprintId')).filter(Boolean);
  console.log(`${sprintIds.length} distinct Notion sprints referenced by tasks${DRY ? '  [DRY RUN]' : ''}`);

  let linked = 0, created = 0, adopted = 0, failed = 0;

  for (const nid of sprintIds) {
    let page;
    try {
      page = await notion.pages.retrieve({ page_id: nid });
    } catch (err) {
      const n = await Task.countDocuments({ notionSprintId: nid });
      console.log(`  ✗ ${nid}: cannot fetch from Notion (${err.code || err.message}) — ${n} tasks left unlinked`);
      failed++;
      continue;
    }

    const props = page.properties || {};
    const titleProp = Object.values(props).find(p => p.type === 'title');
    const name = titleProp?.title?.[0]?.plain_text?.trim() || `Sprint ${nid.slice(0, 6)}`;
    const dateProp = Object.values(props).find(p => p.type === 'date' && p.date);
    const statusProp = Object.values(props).find(p => p.type === 'status' || p.type === 'select');
    const status = mapStatus(statusProp?.status?.name || statusProp?.select?.name);

    let sprint = await Sprint.findOne({ notionId: nid });
    let action = 'exists';
    if (!sprint) {
      sprint = await Sprint.findOne({ name, notionId: { $in: [null, undefined] } });
      if (sprint) {
        action = 'adopted';
        adopted++;
        if (!DRY) { sprint.notionId = nid; await sprint.save(); }
      }
    }
    if (!sprint) {
      action = 'created';
      created++;
      if (!DRY) {
        sprint = await Sprint.create({
          name,
          status,
          startDate: dateProp?.date?.start ? new Date(dateProp.date.start) : undefined,
          endDate: dateProp?.date?.end ? new Date(dateProp.date.end) : undefined,
          goal: 'Imported from Notion',
          notionId: nid,
        });
      }
    }

    const taskCount = await Task.countDocuments({ notionSprintId: nid });
    let modified = 0;
    if (!DRY && sprint) {
      const r = await Task.updateMany(
        { notionSprintId: nid, sprintId: { $ne: sprint._id.toString() } },
        { sprintId: sprint._id.toString() }
      );
      modified = r.modifiedCount;
      linked += modified;
    }
    console.log(`  ✓ "${name}" [${status}] — ${action}, ${taskCount} tasks${DRY ? '' : `, ${modified} newly linked`}`);
    await new Promise(r => setTimeout(r, 350)); // stay under Notion's 3 req/s
  }

  console.log(`\nSummary: ${created} sprints created, ${adopted} adopted by name, ${failed} unreachable, ${DRY ? 'no writes (dry run)' : `${linked} tasks newly linked`}`);
  await mongoose.disconnect();
})().catch(err => { console.error('FAILED:', err); process.exit(1); });
