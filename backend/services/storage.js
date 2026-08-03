/**
 * File storage — four interchangeable backends, chosen by env vars.
 *
 *   1. S3-compatible bucket  — set S3_* vars (Cloudflare R2, B2, AWS S3, MinIO)
 *   2. Hostinger FTP/FTPS    — set FILE_STORAGE=ftp + FTP_* vars. On Hostinger,
 *                              additional FTP accounts are commonly jailed to
 *                              public_html (the live site's web root), so every
 *                              directory we write to gets a `Require all
 *                              denied` .htaccess dropped alongside the files —
 *                              blocks direct HTTP access, leaves FTP and our
 *                              authenticated /api/files/attachments route
 *                              (which fetches over FTP, not HTTP) unaffected.
 *   3. MongoDB GridFS        — set FILE_STORAGE=gridfs (no extra vendor/cost;
 *                              files live in the DB you already run, so they
 *                              survive redeploys and ride along with backups)
 *   4. Local disk            — the default fallback: backend/uploads/
 *                              (fine for dev; wiped on redeploy on most hosts)
 *
 * S3 mode env vars:
 *   S3_ENDPOINT          e.g. https://<accountid>.r2.cloudflarestorage.com
 *   S3_BUCKET            e.g. mayvel-erp-files
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_REGION            optional, defaults to "auto" (correct for R2)
 *
 * FTP mode env vars:
 *   FTP_HOST              from hPanel → Files → FTP Accounts (NOT a File
 *                         Manager browser URL — must accept the FTP protocol)
 *   FTP_USER
 *   FTP_PASSWORD
 *   FTP_PORT              optional, defaults to 21
 *   FTP_SECURE            optional, defaults to "true" (explicit FTPS)
 *   FTP_BASE_DIR          optional, defaults to "/mayvel-attachments" (auto-
 *                         protected with a denial .htaccess — see above)
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Readable, PassThrough } = require('stream');

const uploadsDir = path.join(__dirname, '../uploads');

const FTP_BASE_DIR = process.env.FTP_BASE_DIR || '/mayvel-attachments';
const MIME_BY_EXT = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
  '.zip': 'application/zip', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};

function isS3Configured() {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

function isFtpConfigured() {
  return (process.env.FILE_STORAGE || '').toLowerCase() === 'ftp' &&
    !!(process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASSWORD);
}

function isGridfsEnabled() {
  return (process.env.FILE_STORAGE || '').toLowerCase() === 'gridfs';
}

/** Which backend is active — used for the startup log line. */
function describeBackend() {
  if (isS3Configured()) return 'S3-compatible bucket';
  if (isFtpConfigured()) return `Hostinger FTP (${FTP_BASE_DIR}, private)`;
  if (isGridfsEnabled()) return 'MongoDB GridFS (durable, no extra cost)';
  return 'local disk (backend/uploads) — set FILE_STORAGE=gridfs, FILE_STORAGE=ftp, or S3_* for durable storage';
}

// Kept for backwards compatibility with existing callers/logs.
function isConfigured() {
  return isS3Configured() || isFtpConfigured() || isGridfsEnabled();
}

/**
 * Open a fresh FTP connection. FTP is a single-command-at-a-time protocol, so
 * every call gets its own connection rather than sharing one client — reusing
 * a client across concurrent requests would interleave commands and corrupt
 * transfers.
 */
async function ftpConnect() {
  const { Client } = require('basic-ftp');
  const client = new Client();
  await client.access({
    host: process.env.FTP_HOST,
    port: process.env.FTP_PORT ? parseInt(process.env.FTP_PORT, 10) : 21,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    secure: process.env.FTP_SECURE !== 'false',
    // Hostinger's shared FTPS presents one *.hstgr.io wildcard cert for every
    // customer hostname/IP — there's no per-account SNI cert. Verified via
    // `openssl s_client` that this is genuinely Hostinger's own certificate
    // chain, so we trust it but can't match it against FTP_HOST by name.
    secureOptions: { rejectUnauthorized: false },
  });
  return client;
}

/**
 * If FTP_BASE_DIR lands inside a webserver-served root (as it does on
 * Hostinger, where this FTP account is jailed to public_html), a bare file
 * would be directly downloadable over HTTP with no auth. Drop a `Require all
 * denied` .htaccess in every directory we write to — FTP access is
 * unaffected, only direct HTTP requests get blocked. No-ops if already there.
 */
async function ensureHtaccessProtection(client, dir) {
  const marker = `${dir}/.htaccess`;
  try {
    await client.size(marker);
    return; // already protected
  } catch {
    // not found — write it
  }
  await client.uploadFrom(Readable.from(Buffer.from('Require all denied\n')), '.htaccess');
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

  if (isFtpConfigured()) {
    const client = await ftpConnect();
    try {
      const dir = `${FTP_BASE_DIR}/${path.dirname(key)}`.replace(/\/+/g, '/');
      await client.ensureDir(dir);
      await ensureHtaccessProtection(client, dir);
      await client.uploadFrom(Readable.from(buffer), path.basename(key));
    } finally {
      client.close();
    }
    return { storage: 'ftp', key };
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

  if (isFtpConfigured()) {
    const remotePath = `${FTP_BASE_DIR}/${key}`.replace(/\/+/g, '/');
    const client = await ftpConnect();
    let size;
    try {
      size = await client.size(remotePath);
    } catch {
      client.close();
      return null;
    }
    const stream = new PassThrough();
    // Streams to the caller while the transfer is still in flight; the client
    // closes itself once basic-ftp finishes (or aborts) the download.
    client.downloadTo(stream, remotePath)
      .catch(() => stream.destroy())
      .finally(() => client.close());
    return { body: stream, contentType: MIME_BY_EXT[path.extname(key).toLowerCase()], contentLength: size };
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
