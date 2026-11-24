/**
 * Mirror files uploaded in Mayvel onto the task's Notion page.
 *
 * Why: in-app uploads used to live only in our own file store. When that store
 * was a server disk, a redeploy wiped the bytes and the attachment became a
 * permanent 404 ("could not be found in storage or in Notion"). Notion-imported
 * files never had that problem because /api/files/attachments/:key falls back
 * to Notion by `notionBlockId`. Mirroring each upload to the Notion page gives
 * in-app uploads the same durable fallback.
 *
 * Disable with NOTION_MIRROR_UPLOADS=false. Failures are never fatal to the
 * upload itself — the file is still saved to our own storage.
 */
const { Client } = require('@notionhq/client');

const MAX_SINGLE_PART = 20 * 1024 * 1024; // Notion single-part upload limit

const enabled = () => !!process.env.NOTION_TOKEN && process.env.NOTION_MIRROR_UPLOADS !== 'false';

let client = null;
const notion = () => (client ||= new Client({ auth: process.env.NOTION_TOKEN }));

const blockTypeFor = (mime = '') => {
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
};

/**
 * Upload `buffer` to Notion and append it as a block on `pageId`.
 * Returns the new block id, or null when mirroring is disabled / not possible.
 */
async function mirrorUpload(pageId, buffer, filename, contentType) {
  if (!enabled() || !pageId || !buffer?.length || buffer.length > MAX_SINGLE_PART) return null;
  const type = contentType || 'application/octet-stream';
  const upload = await notion().fileUploads.create({ mode: 'single_part', filename, content_type: type });
  await notion().fileUploads.send({
    file_upload_id: upload.id,
    file: { filename, data: new Blob([buffer], { type }) },
  });
  const blockType = blockTypeFor(type);
  const resp = await notion().blocks.children.append({
    block_id: pageId,
    children: [{ type: blockType, [blockType]: { type: 'file_upload', file_upload: { id: upload.id } } }],
  });
  return resp.results?.[0]?.id || null;
}

/** Remove a block we mirrored earlier (archives it in Notion; restorable from trash). */
async function removeMirroredBlock(blockId) {
  if (!enabled() || !blockId || blockId.includes(':prop:')) return;
  await notion().blocks.delete({ block_id: blockId });
}

module.exports = { mirrorUpload, removeMirroredBlock, enabled };
