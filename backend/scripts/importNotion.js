/**
 * Notion → MongoDB task sync.
 * - Token & database id come from backend/.env (never hardcoded).
 * - NON-destructive: upserts by task `id` (notion_<pageId>), so tasks created
 *   inside Mayvel are never touched and re-running is safe.
 * - Reuses the real Task model (no schema drift).
 *
 * Usage: node scripts/importNotion.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const { Client } = require('@notionhq/client');
const mongoose = require('mongoose');
const { Task } = require('../models/Task');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASKS_DB     = process.env.NOTION_TASKS_DB;
const MONGO_URI    = process.env.MONGODB_URI || 'mongodb://localhost:27017/mayvel_task_management';

if (!NOTION_TOKEN || !TASKS_DB) {
  console.error('Missing NOTION_TOKEN or NOTION_TASKS_DB in backend/.env');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// ─── Status Mapping ───────────────────────────────────────────────────────────
function mapStatus(notionStatus) {
  if (!notionStatus) return 'Not Yet Started';
  const s = notionStatus.toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'complete') return 'Completed';
  if (s === 'in progress' || s === 'in-progress' || s === 'doing') return 'In Progress';
  if (s === 'in review' || s === 'review' || s === 'under review') return 'In Review';
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled') return 'Rejected';
  return 'Not Yet Started';
}

// ─── Extract simple value from property ──────────────────────────────────────
function extractProp(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':        return prop.title?.map(t => t.plain_text).join('') || '';
    case 'rich_text':    return prop.rich_text?.map(t => t.plain_text).join('') || '';
    case 'select':       return prop.select?.name || '';
    case 'status':       return prop.status?.name || '';
    case 'multi_select': return prop.multi_select?.map(s => s.name) || [];
    case 'date':         return prop.date?.start || null;
    case 'number':       return prop.number ?? null;
    case 'checkbox':     return prop.checkbox ?? false;
    case 'url':          return prop.url || '';
    case 'people':       return prop.people?.map(p => p.name).join(', ') || '';
    case 'relation':     return prop.relation?.map(r => r.id) || [];
    case 'unique_id':    return prop.unique_id?.number ? String(prop.unique_id.number) : null;
    default:             return null;
  }
}

// ─── Fetch all pages from a datasource ───────────────────────────────────────
async function fetchAll(dataSourceId) {
  let results = [];
  let cursor;
  do {
    const resp = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      start_cursor: cursor,
    });
    results = results.concat(resp.results);
    cursor = resp.has_more ? resp.next_cursor : null;
    process.stdout.write(`\r  Fetched ${results.length} records...`);
  } while (cursor);
  console.log(`\r  ✅ Fetched ${results.length} total records`);
  return results;
}

// ─── Main Sync ────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  console.log('📥 Fetching tasks from Notion...');
  const notionTasks = await fetchAll(TASKS_DB);

  console.log('💾 Upserting into MongoDB (non-destructive)...');
  let skipped = 0;
  const BATCH = 200;
  let processed = 0;

  for (let i = 0; i < notionTasks.length; i += BATCH) {
    const batch = notionTasks.slice(i, i + BATCH);
    const ops = [];

    for (const page of batch) {
      const p = page.properties;

      const title = extractProp(p['Task name']) || extractProp(p['Name']) || extractProp(p['Title']) || 'Untitled';
      if (!title || (title === 'Untitled' && Object.keys(p).length < 3)) { skipped++; continue; }

      const rawStatus   = extractProp(p['Status']) || '';
      const assigneeRaw = extractProp(p['Assignee']) || '';
      const startDate   = extractProp(p['Start Date']);
      const endDate     = extractProp(p['End Date']);
      const estHours    = extractProp(p['Estimated Time']);
      const actHours    = extractProp(p['Elapsed Time']);
      const taskType    = extractProp(p['Task type']) || [];
      const sprintRels  = extractProp(p['Sprint']) || [];
      const projectRels = extractProp(p['Project']) || [];
      const parentRels  = extractProp(p['Parent task']) || [];

      const doc = {
        id:             `notion_${page.id.replace(/-/g, '')}`,
        notionId:       page.id,
        title,
        status:         mapStatus(rawStatus),
        priority:       extractProp(p['Priority']) || '',
        assignee:       typeof assigneeRaw === 'string' ? assigneeRaw.split(',')[0].trim() : '',
        startDate:      startDate ? new Date(startDate) : null,
        dueDate:        endDate ? new Date(endDate) : null,
        estimatedHours: estHours ? Number(estHours) : 0,
        actualHours:    actHours ? Number(actHours) : 0,
        taskType:       Array.isArray(taskType) ? taskType : [taskType].filter(Boolean),
        notionSprintId: sprintRels[0] || null,
        notionProjectId: projectRels[0] || null,
        parentId:       parentRels[0] ? `notion_${parentRels[0].replace(/-/g, '')}` : null,
        createdDate:    new Date(page.created_time),
      };

      ops.push({
        updateOne: {
          filter: { id: doc.id },
          update: { $set: doc },
          upsert: true,
        },
      });
    }

    if (ops.length > 0) await Task.bulkWrite(ops, { ordered: false });
    processed = Math.min(i + BATCH, notionTasks.length);
    process.stdout.write(`\r  Progress: ${processed}/${notionTasks.length}`);
  }

  console.log(`\n\n✅ Sync complete! Upserted: ${notionTasks.length - skipped}, Skipped: ${skipped}`);

  const counts = await Task.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  console.log('\n📊 Task breakdown by status:');
  for (const c of counts) console.log(`   ${c._id}: ${c.count}`);

  await mongoose.disconnect();
  console.log('\n🔌 Disconnected. Done!');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
