/**
 * Import files attached to Notion task pages into Mayvel ERP.
 *
 * Notion-hosted file URLs are signed and expire in ~1 hour, so files must be
 * downloaded and re-hosted rather than linked. External files (Google Drive,
 * Dropbox, …) are kept as links since we don't own that hosting.
 *
 * Walks each imported task's Notion page recursively, collecting file / image /
 * pdf / video / audio blocks plus any `files`-type properties.
 *
 *   node scripts/importNotionFiles.js --scan     discovery only, writes nothing
 *   node scripts/importNotionFiles.js            download + store + attach
 *   node scripts/importNotionFiles.js --limit=50 process only the first 50 tasks
 *
 * Idempotent: attachments record their Notion block id, so re-runs skip
 * anything already imported. Safe to stop and resume.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');
const { Client } = require('@notionhq/client');
const { Task } = require('../models/Task');
const fileStore = require('../services/storage');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const MONGO_URI = process.env.MONGODB_URI;
if (!NOTION_TOKEN || !MONGO_URI) {
  console.error('Missing NOTION_TOKEN or MONGODB_URI in backend/.env');
  process.exit(1);
}

const SCAN_ONLY = process.argv.includes('--scan');
const LIMIT = (() => {
  const a = process.argv.find(x => x.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : 0;
})();

const notion = new Client({ auth: NOTION_TOKEN });
const FILE_BLOCK_TYPES = new Set(['file', 'image', 'pdf', 'video', 'audio']);
const CONCURRENCY = 3;              // Notion allows ~3 req/s
const MAX_FILE_BYTES = 25 * 1024 * 1024; // skip anything bigger

/**
 * Hard storage ceiling, in MB of actual database storage.
 *
 * This MUST be measured from db.stats(), not from bytes downloaded: GridFS adds
 * chunk overhead and the cluster quota counts indexes and other collections
 * too, so "bytes fetched" runs well behind real usage. A previous run trusted a
 * downloaded-bytes counter, sailed past its limit, and exhausted a 512MB Atlas
 * quota — which blocks ALL writes cluster-wide, taking the app down.
 * Default leaves generous headroom under a 512MB free tier.
 */
const MAX_STORAGE_MB = (() => {
  const a = process.argv.find(x => x.startsWith('--max-storage-mb='));
  return a ? parseInt(a.split('=')[1], 10) : 300;
})();

const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

let aborted = false;

/** Actual database storage in MB, straight from the server. */
async function storageUsedMb() {
  const s = await mongoose.connection.db.stats();
  return (s.storageSize + s.indexSize) / 1048576;
}

/** Retry wrapper for Notion rate limits (429) and transient errors. */
async function notionCall(fn, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err.status === 429 || err.status === 502 || err.status === 503;
      if (!retryable || i === attempts - 1) throw err;
      const wait = err.status === 429 ? (Number(err.headers?.['retry-after']) || 2) * 1000 : 1000 * (i + 1);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

/** Derive a filename for a Notion file object. */
function fileName(block, data, idx) {
  if (data?.name) return data.name;
  const url = data?.file?.url || data?.external?.url || '';
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (base) return base;
  } catch {}
  const extByType = { image: '.png', pdf: '.pdf', video: '.mp4', audio: '.mp3', file: '' };
  return `${block.type}-${idx}${extByType[block.type] || ''}`;
}

/** Recursively collect file items from a Notion page's block tree. */
async function collectFiles(pageId) {
  const found = [];
  const queue = [pageId];
  const seen = new Set();

  while (queue.length) {
    const blockId = queue.shift();
    if (seen.has(blockId)) continue;
    seen.add(blockId);

    let cursor;
    do {
      let resp;
      try {
        resp = await notionCall(() => notion.blocks.children.list({
          block_id: blockId, start_cursor: cursor, page_size: 100,
        }));
      } catch {
        break; // inaccessible block subtree — skip it
      }

      for (const [i, b] of resp.results.entries()) {
        if (FILE_BLOCK_TYPES.has(b.type)) {
          const data = b[b.type];
          const url = data?.file?.url || data?.external?.url;
          if (url) {
            found.push({
              notionBlockId: b.id,
              name: fileName(b, data, i),
              url,
              hosted: data?.type === 'file',   // Notion-hosted → must download
              blockType: b.type,
            });
          }
        }
        if (b.has_children) queue.push(b.id);
      }
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
  }
  return found;
}

/** Collect files from `files`-type page properties. */
function collectPropertyFiles(page) {
  const out = [];
  for (const [key, val] of Object.entries(page?.properties || {})) {
    if (val.type !== 'files' || !val.files?.length) continue;
    val.files.forEach((f, i) => {
      const url = f.file?.url || f.external?.url;
      if (!url) return;
      out.push({
        notionBlockId: `${page.id}:prop:${key}:${i}`,
        name: f.name || `${key}-${i}`,
        url,
        hosted: f.type === 'file',
        blockType: `property:${key}`,
      });
    });
  }
  return out;
}

/** Fetch bytes for a file, with a size guard. */
async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > MAX_FILE_BYTES) throw new Error(`too large (${mb(len)})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new Error(`too large (${mb(buf.length)})`);
  return { buffer: buf, contentType: res.headers.get('content-type') || undefined };
}

/**
 * Learn a file's size without downloading it (scan mode). Notion's signed CDN
 * URLs don't answer HEAD, so ask for a single byte and read the total out of
 * the Content-Range header ("bytes 0-0/12345").
 */
async function probeSize(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const range = res.headers.get('content-range');
    if (range) {
      const total = Number(range.split('/')[1]);
      if (Number.isFinite(total)) return total;
    }
    return Number(res.headers.get('content-length') || 0);
  } catch {
    return 0;
  }
}

/** Run `worker` over `items` with bounded concurrency. */
async function pool(items, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

async function main() {
  console.log(SCAN_ONLY ? '🔍 SCAN MODE — nothing will be written\n' : '📥 IMPORT MODE\n');
  await mongoose.connect(MONGO_URI);
  if (!SCAN_ONLY) console.log(`Storage backend: ${fileStore.describeBackend()}\n`);

  const query = Task.find({ notionId: { $exists: true, $ne: null } }, 'id title notionId attachments');
  if (LIMIT) query.limit(LIMIT);
  const tasks = await query;
  console.log(`Walking ${tasks.length} Notion-linked tasks…\n`);

  const stats = { scanned: 0, tasksWithFiles: 0, files: 0, bytes: 0, imported: 0, skipped: 0, linked: 0, failed: 0 };
  const failures = [];

  if (!SCAN_ONLY) {
    console.log(`Storage ceiling: ${MAX_STORAGE_MB} MB (currently ${(await storageUsedMb()).toFixed(1)} MB)\n`);
  }

  await pool(tasks, async (task) => {
    if (aborted) return;
    stats.scanned++;
    if (stats.scanned % 25 === 0) {
      process.stdout.write(`\r  progress ${stats.scanned}/${tasks.length} · files ${stats.files} · ${mb(stats.bytes)}   `);
    }

    let items;
    try {
      const page = await notionCall(() => notion.pages.retrieve({ page_id: task.notionId }));
      items = [...collectPropertyFiles(page), ...await collectFiles(task.notionId)];
    } catch (err) {
      failures.push(`${task.title}: page unreachable (${err.message})`);
      stats.failed++;
      return;
    }
    if (!items.length) return;

    // Skip anything already imported (idempotency)
    const have = new Set((task.attachments || []).map(a => a.notionBlockId).filter(Boolean));
    const fresh = items.filter(it => !have.has(it.notionBlockId));
    stats.skipped += items.length - fresh.length;
    if (!fresh.length) return;

    stats.tasksWithFiles++;
    stats.files += fresh.length;

    if (SCAN_ONLY) {
      for (const it of fresh) {
        stats.bytes += it.hosted ? await probeSize(it.url) : 0;
      }
      console.log(`\n  ${task.title.slice(0, 44)}`);
      fresh.forEach(it => console.log(`      ${it.hosted ? '⬇' : '🔗'} ${it.name}  (${it.blockType})`));
      return;
    }

    const added = [];
    for (const it of fresh) {
      if (!it.hosted) {
        // External host — keep as a link, nothing to re-host.
        added.push({
          id: crypto.randomUUID(), name: it.name, path: it.url,
          sizeBytes: 0, addedAt: new Date(), notionBlockId: it.notionBlockId,
        });
        stats.linked++;
        continue;
      }
      // Hard guard: re-measure real storage before every stored file.
      const used = await storageUsedMb();
      if (used >= MAX_STORAGE_MB) {
        aborted = true;
        console.log(`\n\n⛔ STOPPING: database storage at ${used.toFixed(1)} MB, ceiling is ${MAX_STORAGE_MB} MB.`);
        console.log('   Nothing was corrupted — already-imported files are kept and the run is resumable.');
        console.log('   Raise with --max-storage-mb=N, upgrade the cluster, or switch to S3_* storage.');
        break;
      }
      try {
        const { buffer, contentType } = await download(it.url);
        const ext = path.extname(it.name).toLowerCase() || '';
        const key = `${crypto.randomBytes(16).toString('hex')}${ext}`;
        await fileStore.putFile(`attachments/${key}`, buffer, contentType);
        added.push({
          id: crypto.randomUUID(), name: it.name,
          path: `/api/files/attachments/${key}`,
          sizeBytes: buffer.length, addedAt: new Date(), notionBlockId: it.notionBlockId,
        });
        stats.bytes += buffer.length;
        stats.imported++;
      } catch (err) {
        failures.push(`${task.title} / ${it.name}: ${err.message}`);
        stats.failed++;
      }
    }

    if (added.length) {
      await Task.updateOne({ id: task.id }, { $push: { attachments: { $each: added } } });
    }
  });

  console.log('\n\n' + '─'.repeat(52));
  console.log(`tasks walked:        ${stats.scanned}`);
  console.log(`tasks with files:    ${stats.tasksWithFiles}`);
  console.log(`file items found:    ${stats.files}`);
  if (SCAN_ONLY) {
    console.log(`downloadable size:   ${mb(stats.bytes)}  ← must fit your DB/bucket quota`);
    console.log('\nRun without --scan to import.');
  } else {
    console.log(`downloaded+stored:   ${stats.imported}  (${mb(stats.bytes)})`);
    console.log(`kept as links:       ${stats.linked}`);
    console.log(`already imported:    ${stats.skipped}`);
    console.log(`failed:              ${stats.failed}`);
  }
  if (failures.length) {
    console.log(`\nfirst failures:`);
    failures.slice(0, 15).forEach(f => console.log('  -', f));
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error('\n❌', e); process.exit(1); });
