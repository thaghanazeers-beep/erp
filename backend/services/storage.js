/**
 * File storage — S3-compatible object storage with local-disk fallback.
 *
 * When S3_* env vars are set (any S3-compatible provider: Cloudflare R2,
 * Backblaze B2, AWS S3, MinIO…), files live in a PRIVATE bucket and are
 * served through the app's own routes. When unset (e.g. local dev), files
 * fall back to backend/uploads/ on disk — same behavior as before.
 *
 * Required env vars for S3 mode:
 *   S3_ENDPOINT          e.g. https://<accountid>.r2.cloudflarestorage.com
 *   S3_BUCKET            e.g. mayvel-erp-files
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_REGION            optional, defaults to "auto" (correct for R2)
 */
const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '../uploads');

function isConfigured() {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

let client = null;
function getClient() {
  const { S3Client } = require('@aws-sdk/client-s3');
  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'auto',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true, // required by R2/B2/MinIO
    });
  }
  return client;
}

/** Store a file buffer under `key` (e.g. "attachments/ab12….pdf"). */
async function putFile(key, buffer, contentType) {
  if (isConfigured()) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getClient().send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }));
    return { storage: 's3', key };
  }
  // Disk fallback — flatten the key (uploads/ has no subdirectories)
  const filename = key.split('/').pop();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  return { storage: 'disk', key: filename };
}

/**
 * Fetch a stored file. Returns { body, contentType, contentLength } where
 * `body` is a readable stream, or null if the file doesn't exist.
 */
async function getFile(key) {
  if (isConfigured()) {
    try {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const obj = await getClient().send(new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
      }));
      return { body: obj.Body, contentType: obj.ContentType, contentLength: obj.ContentLength };
    } catch {
      return null;
    }
  }
  const filePath = path.join(uploadsDir, key.split('/').pop());
  if (!fs.existsSync(filePath)) return null;
  return {
    body: fs.createReadStream(filePath),
    contentType: undefined,
    contentLength: fs.statSync(filePath).size,
  };
}

module.exports = { isConfigured, putFile, getFile };
