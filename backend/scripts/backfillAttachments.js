/**
 * Copy every Notion-synced attachment into durable file storage (FTP / S3 / GridFS),
 * so previews never depend on Notion's expiring links again. Safe to re-run:
 * files already in storage are skipped.
 *
 * Usage: node scripts/backfillAttachments.js [--max-mb=100] [--dry-run]
 * Needs MONGODB_URI, NOTION_TOKEN and a storage backend (FILE_STORAGE / S3_*) in backend/.env
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const path = require('path');
const mongoose = require('mongoose');
const { Client } = require('@notionhq/client');
const fileStore = require('../services/storage');
const { Task } = require('../models/Task');

const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] || d;
const MAX = Number(arg('max-mb', 100)) * 1024 * 1024;
const DRY = process.argv.includes('--dry-run');
const PREFIX = '/api/files/attachments/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function notionUrl(notion, id) {
  const prop = id.match(/^(.+?):prop:(.+):(\d+)$/);
  if (prop) {
    const page = await notion.pages.retrieve({ page_id: prop[1] });
    const f = page.properties?.[prop[2]]?.files?.[Number(prop[3])];
    return f?.file?.url || f?.external?.url || null;
  }
  const b = await notion.blocks.retrieve({ block_id: id });
  const d = b?.[b.type];
  return d?.file?.url || d?.external?.url || null;
}

(async () => {
  if (!process.env.NOTION_TOKEN) { console.error('Missing NOTION_TOKEN'); process.exit(1); }
  if (!fileStore.isConfigured()) { console.error('No durable storage configured. ' + fileStore.describeBackend()); process.exit(1); }
  console.log('Storage:', fileStore.describeBackend());
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mayvel_task_management');
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  const tasks = await Task.find({ 'attachments.notionBlockId': { $exists: true } }, 'id attachments').lean();
  const stats = { stored: 0, already: 0, tooBig: 0, failed: 0 };
  for (const t of tasks) {
    for (const a of t.attachments || []) {
      if (!a.notionBlockId || !a.path?.startsWith(PREFIX)) continue;
      const key = a.path.slice(PREFIX.length);
      try {
        if (await fileStore.getFile(`attachments/${key}`)) { stats.already++; continue; }
        if (DRY) { stats.stored++; continue; }
        const url = await notionUrl(notion, a.notionBlockId);
        if (!url) throw new Error('no URL from Notion (block deleted or no access)');
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Notion download HTTP ${r.status}`);
        const len = Number(r.headers.get('content-length')) || 0;
        if (len > MAX) { stats.tooBig++; console.log(`skip (too big ${(len / 1048576).toFixed(0)} MB): ${a.name}`); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > MAX) { stats.tooBig++; continue; }
        await fileStore.putFile(`attachments/${key}`, buf, r.headers.get('content-type') || undefined);
        stats.stored++;
        process.stdout.write(`\r  stored ${stats.stored} · already ${stats.already} · failed ${stats.failed}   `);
        await sleep(350); // stay under Notion's ~3 req/s
      } catch (e) { stats.failed++; console.log(`\nfailed: ${t.id} / ${a.name}: ${e.message}`); }
    }
  }
  console.log(`\n\nDone${DRY ? ' (dry run)' : ''}:`, stats);
  await mongoose.disconnect();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
