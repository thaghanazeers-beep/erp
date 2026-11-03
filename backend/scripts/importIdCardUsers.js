/**
 * Create / update app users from the staff ID cards (Figma "Mayvel Printable Design").
 * Reads backend/scripts/data/idcard-users.json (gitignored: it holds phone numbers):
 *   [{ name, email, phone, employeeId, existing, confidence }]
 *
 *   node scripts/importIdCardUsers.js           dry run (default): prints what would change
 *   node scripts/importIdCardUsers.js --apply   writes to MongoDB
 *
 * Existing accounts (matched by email) only get a phone number filled in when blank; their
 * name and role are never touched. New accounts are created as Member. Login stays Microsoft SSO,
 * so each email must match the person's real @mayvel.ai mailbox.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const User = require('../models/User');
const rows = require('./data/idcard-users.json');
const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mayvel_task_management');
  const stats = { created: 0, phoneAdded: 0, unchanged: 0 };
  for (const r of rows) {
    const email = r.email.trim().toLowerCase();
    const u = await User.findOne({ email });
    if (u) {
      if (!u.phone && r.phone) { stats.phoneAdded++; console.log(`~ ${email}: add phone ${r.phone}`); if (APPLY) { u.phone = r.phone; await u.save(); } }
      else stats.unchanged++;
      continue;
    }
    stats.created++; console.log(`+ ${r.name} <${email}> ${r.phone}${r.confidence === 'check' ? '   (email guessed - check)' : ''}`);
    if (APPLY) await User.create({ name: r.name, email, phone: r.phone, role: 'Member', active: true });
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}:`, stats);
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
