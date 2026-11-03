/**
 * Create / update app users from the staff ID cards (Figma "Mayvel Printable Design").
 * Reads backend/scripts/data/idcard-users.json (gitignored: it holds phone numbers):
 *   [{ name, email, phone, employeeId, existing, confidence }]
 *
 *   node scripts/importIdCardUsers.js           dry run (default): prints what would change
 *   node scripts/importIdCardUsers.js --apply   writes to MongoDB (creates users + photos)
 *   node scripts/importIdCardUsers.js --photos-only   only uploads photos for accounts that already exist
 *
 * Photos come from scripts/data/avatars/<key>.jpg (face-cropped from the ID cards) and are uploaded to
 * the configured file store, so run with FILE_STORAGE=ftp (or S3) to match production.
 *
 * Existing accounts (matched by email) only get a phone number filled in when blank; their
 * name and role are never touched. New accounts are created as Member. Login stays Microsoft SSO,
 * so each email must match the person's real @mayvel.ai mailbox.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const fileStore = require('../services/storage');
const rows = require('./data/idcard-users.json');
const PHOTOS_ONLY = process.argv.includes('--photos-only');
const APPLY = process.argv.includes('--apply') || PHOTOS_ONLY;
const photoPath = (r) => path.join(__dirname, 'data', 'avatars', `${r.key}.jpg`);
async function uploadPhoto(r) {
  const f = photoPath(r);
  if (!fs.existsSync(f)) return null;
  if (!fileStore.isConfigured()) { console.log(`  ! no durable file storage configured - skipping photo for ${r.name}`); return null; }
  const filename = `${crypto.randomBytes(16).toString('hex')}.jpg`;
  await fileStore.putFile(`avatars/${filename}`, fs.readFileSync(f), 'image/jpeg');
  return `/files/avatars/${filename}`;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mayvel_task_management');
  const stats = { created: 0, phoneAdded: 0, photos: 0, unchanged: 0 };
  for (const r of rows) {
    const email = r.email.trim().toLowerCase();
    const u = await User.findOne({ email });
    if (u) {
      if (fs.existsSync(photoPath(r))) { stats.photos++; console.log(`~ ${email}: set photo`); if (APPLY) { const url = await uploadPhoto(r); if (url) { u.profilePictureUrl = url; await u.save(); } } }
      if (PHOTOS_ONLY) continue;
      if (!u.phone && r.phone) { stats.phoneAdded++; console.log(`~ ${email}: add phone ${r.phone}`); if (APPLY) { u.phone = r.phone; await u.save(); } }
      else stats.unchanged++;
      continue;
    }
    if (PHOTOS_ONLY) continue;
    stats.created++; console.log(`+ ${r.name} <${email}> ${r.phone}${r.confidence === 'check' ? '   (email guessed - check)' : ''}`);
    if (APPLY) await User.create({ name: r.name, email, phone: r.phone, role: 'Member', active: true, profilePictureUrl: await uploadPhoto(r) || undefined });
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}:`, stats);
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
