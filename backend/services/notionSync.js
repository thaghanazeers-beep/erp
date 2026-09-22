/**
 * Notion → Mayvel live sync, callable from the API (header button) and from
 * the CLI scripts. Two phases, both non-destructive:
 *   1. tasks    — upsert every page of the Notion tasks database by
 *                 id `notion_<pageId>`; tasks created in Mayvel are untouched.
 *   2. sprints  — fetch each sprint page referenced by a task, upsert the
 *                 Sprint (match by notionId, then by exact name) and link tasks.
 *
 * One run at a time per process; `status()` reports progress for polling.
 */
const { Client } = require('@notionhq/client');
const { Task } = require('../models/Task');
const User = require('../models/User');
const Sprint = require('../models/Sprint');

const state = { running: false, startedAt: null, finishedAt: null, startedBy: '', phase: '', progress: '', result: null, error: null };
const status = () => ({ ...state, configured: !!(process.env.NOTION_TOKEN && process.env.NOTION_TASKS_DB) });

const mapTaskStatus = (s) => {
  const v = String(s || '').toLowerCase();
  if (['done', 'completed', 'complete'].includes(v)) return 'Completed';
  if (['in progress', 'in-progress', 'doing'].includes(v)) return 'In Progress';
  if (['in review', 'review', 'under review'].includes(v)) return 'In Review';
  if (['rejected', 'cancelled', 'canceled'].includes(v)) return 'Rejected';
  return 'Not Yet Started';
};
const mapSprintStatus = (s) => {
  const v = String(s || '').toLowerCase();
  if (['active', 'in progress', 'current'].includes(v)) return 'active';
  if (['completed', 'done', 'past'].includes(v)) return 'completed';
  return 'planned';
};
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchAllPages(notion, dataSourceId, onProgress) {
  let results = []; let cursor;
  do {
    const resp = await notion.dataSources.query({ data_source_id: dataSourceId, page_size: 100, start_cursor: cursor });
    results = results.concat(resp.results);
    cursor = resp.has_more ? resp.next_cursor : null;
    onProgress?.(`Fetched ${results.length} tasks from Notion…`);
  } while (cursor);
  return results;
}

/** Phase 1: tasks. Returns { fetched, upserted, skipped }. */
async function syncTasks(notion, log) {
  const aliasMap = new Map();
  for (const u of await User.find({ aliases: { $exists: true, $ne: [] } }, 'name aliases')) for (const a of u.aliases) aliasMap.set(String(a).trim().toLowerCase(), u.name);
  const resolveName = (n) => aliasMap.get(String(n || '').trim().toLowerCase()) || n;

  const pages = await fetchAllPages(notion, process.env.NOTION_TASKS_DB, log);
  let skipped = 0; const BATCH = 200;
  for (let i = 0; i < pages.length; i += BATCH) {
    const ops = [];
    for (const page of pages.slice(i, i + BATCH)) {
      const p = page.properties;
      const title = extractProp(p['Task name']) || extractProp(p['Name']) || extractProp(p['Title']) || 'Untitled';
      if (!title || (title === 'Untitled' && Object.keys(p).length < 3)) { skipped++; continue; }
      const assigneeRaw = extractProp(p['Assignee']) || '';
      const startDate = extractProp(p['Start Date']); const endDate = extractProp(p['End Date']);
      const estHours = extractProp(p['Estimated Time']); const actHours = extractProp(p['Elapsed Time']);
      const taskType = extractProp(p['Task type']) || [];
      const sprintRels = extractProp(p['Sprint']) || []; const projectRels = extractProp(p['Project']) || []; const parentRels = extractProp(p['Parent task']) || [];
      const doc = {
        id: `notion_${page.id.replace(/-/g, '')}`, notionId: page.id, title,
        status: mapTaskStatus(extractProp(p['Status'])), priority: extractProp(p['Priority']) || '',
        assignee: typeof assigneeRaw === 'string' ? resolveName(assigneeRaw.split(',')[0].trim()) : '',
        startDate: startDate ? new Date(startDate) : null, dueDate: endDate ? new Date(endDate) : null,
        estimatedHours: estHours ? Number(estHours) : 0, actualHours: actHours ? Number(actHours) : 0,
        taskType: Array.isArray(taskType) ? taskType : [taskType].filter(Boolean),
        notionSprintId: sprintRels[0] || null, notionProjectId: projectRels[0] || null,
        parentId: parentRels[0] ? `notion_${parentRels[0].replace(/-/g, '')}` : null,
        createdDate: new Date(page.created_time),
      };
      ops.push({ updateOne: { filter: { id: doc.id }, update: { $set: doc }, upsert: true } });
    }
    if (ops.length) await Task.bulkWrite(ops, { ordered: false });
    log(`Saved ${Math.min(i + BATCH, pages.length)}/${pages.length} tasks…`);
  }
  return { fetched: pages.length, upserted: pages.length - skipped, skipped };
}

/** Phase 2: sprints. Returns { sprints, created, adopted, unreachable, linked }. */
async function syncSprints(notion, log, { dryRun = false } = {}) {
  const sprintIds = (await Task.distinct('notionSprintId')).filter(Boolean);
  let linked = 0, created = 0, adopted = 0, unreachable = 0, n = 0;
  for (const nid of sprintIds) {
    n++; log(`Linking sprint ${n}/${sprintIds.length}…`);
    let page;
    try { page = await notion.pages.retrieve({ page_id: nid }); } catch { unreachable++; continue; }
    const props = page.properties || {};
    const titleProp = Object.values(props).find(p => p.type === 'title');
    const name = titleProp?.title?.[0]?.plain_text?.trim() || `Sprint ${nid.slice(0, 6)}`;
    const dateProp = Object.values(props).find(p => p.type === 'date' && p.date);
    const statusProp = Object.values(props).find(p => p.type === 'status' || p.type === 'select');
    const sStatus = mapSprintStatus(statusProp?.status?.name || statusProp?.select?.name);
    let sprint = await Sprint.findOne({ notionId: nid });
    if (!sprint) { sprint = await Sprint.findOne({ name, notionId: { $in: [null, undefined] } }); if (sprint) { adopted++; if (!dryRun) { sprint.notionId = nid; await sprint.save(); } } }
    if (!sprint) { created++; if (!dryRun) sprint = await Sprint.create({ name, status: sStatus, startDate: dateProp?.date?.start ? new Date(dateProp.date.start) : undefined, endDate: dateProp?.date?.end ? new Date(dateProp.date.end) : undefined, goal: 'Imported from Notion', notionId: nid }); }
    if (!dryRun && sprint) { const r = await Task.updateMany({ notionSprintId: nid, sprintId: { $ne: sprint._id.toString() } }, { sprintId: sprint._id.toString() }); linked += r.modifiedCount; }
    await sleep(350); // stay under Notion's 3 req/s
  }
  return { sprints: sprintIds.length, created, adopted, unreachable, linked };
}

/**
 * Run the full sync. Resolves with the result; throws if a run is already in
 * progress or Notion is not configured. `log` receives progress lines.
 */
async function runNotionSync({ startedBy = 'system', log = () => {}, phases = ['tasks', 'sprints'] } = {}) {
  if (state.running) { const e = new Error('A Notion sync is already running'); e.code = 'BUSY'; throw e; }
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_TASKS_DB) { const e = new Error('NOTION_TOKEN / NOTION_TASKS_DB are not set on the server'); e.code = 'UNCONFIGURED'; throw e; }
  Object.assign(state, { running: true, startedAt: new Date(), finishedAt: null, startedBy, phase: 'tasks', progress: 'Connecting to Notion…', result: null, error: null });
  const progress = (msg) => { state.progress = msg; log(msg); };
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  try {
    const result = {};
    if (phases.includes('tasks')) { state.phase = 'tasks'; result.tasks = await syncTasks(notion, progress); }
    if (phases.includes('sprints')) { state.phase = 'sprints'; result.sprints = await syncSprints(notion, progress); }
    result.durationMs = Date.now() - state.startedAt.getTime();
    Object.assign(state, { running: false, finishedAt: new Date(), phase: 'done', progress: 'Done', result });
    return result;
  } catch (err) {
    Object.assign(state, { running: false, finishedAt: new Date(), phase: 'failed', progress: '', error: err.message });
    throw err;
  }
}

module.exports = { runNotionSync, syncTasks, syncSprints, status };
