/**
 * File storage — three interchangeable backends, chosen by env vars.
 *
 *   1. S3-compatible bucket  — set S3_* vars (Cloudflare R2, B2, AWS S3, MinIO)
 *   2. MongoDB GridFS        — set FILE_STORAGE=gridfs (no extra vendor/cost;
 *                              files live in the DB you already run, so they
 *                              survive redeploys and ride along with backups)
 *   3. Local disk            — the default fallback: backend/uploads/
 *                              (fine for dev; wiped on redeploy on most hosts)
 *
 * S3 mode env vars:
 *   S3_ENDPOINT          e.g. https://<accountid>.r2.cloudflarestorage.com
 *   S3_BUCKET            e.g. mayvel-erp-files
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_REGION            optional, defaults to "auto" (correct for R2)
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const uploadsDir = path.join(__dirname, '../uploads');

function isS3Configured() {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

function isGridfsEnabled() {
  return (process.env.FILE_STORAGE || '').toLowerCase() === 'gridfs';
}

/** Which backend is active — used for the startup log line. */
function describeBackend() {
  if (isS3Configured()) return 'S3-compatible bucket';
  if (isGridfsEnabled()) return 'MongoDB GridFS (durable, no extra cost)';
  return 'local disk (backend/uploads) — set FILE_STORAGE=gridfs or S3_* for durable storage';
}

// Kept for backwards compatibility with existing callers/logs.
function isConfigured() {
  return isS3Configured() || isGridfsEnabled();
}

function getBucket() {
  if (mongoose.connection.readyState !== 1) throw new Error('Database not connected');
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'fs' });
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
  if (isS3Configured()) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getClient().send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }));
    return { storage: 's3', key };
  }

  if (isGridfsEnabled()) {
    const bucket = getBucket();
    const type = contentType || 'application/octet-stream';
    await new Promise((resolve, reject) => {
      // Also in metadata: the top-level contentType option isn't preserved by
      // every driver version, and metadata always is.
      const stream = bucket.openUploadStream(key, { contentType: type, metadata: { contentType: type } });
      stream.on('finish', resolve);
      stream.on('error', reject);
      stream.end(buffer);
    });
    return { storage: 'gridfs', key };
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
  if (isS3Configured()) {
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

  if (isGridfsEnabled()) {
    try {
      const bucket = getBucket();
      const [doc] = await bucket.find({ filename: key }).limit(1).toArray();
      if (!doc) return null;
      return {
        body: bucket.openDownloadStream(doc._id),
        contentType: doc.contentType || doc.metadata?.contentType,
        contentLength: doc.length,
      };
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

module.exports = { isConfigured, describeBackend, putFile, getFile };
