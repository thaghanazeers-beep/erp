/**
 * One-off migration of legacy Mayvel ERP master data into the new app.
 *
 *   node scripts/importErpSeed.js [--dry] [--file scripts/data/erp-seed.json]
 *
 * Input is the JSON captured from the old portal (rate card, project list with
 * budgets, sprints, booking categories, org hierarchy). Idempotent: projects are
 * matched by name, rate-card rows by (user, effectiveDate). People are matched
 * to app users by name or alias (case/space-insensitive); unmatched names are
 * listed at the end so you can invite or merge them and re-run.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const Sprint = require('../models/Sprint');
const { ResourceCost, BudgetRequest } = require('../models/Erp');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : path.join(__dirname, 'data', 'erp-seed.json');

// Project type as shown in the legacy P&L summary; anything else defaults to Service.
const TYPE_BY_NAME = [
  [/^(BACSYS|PI |PI-|Seyo|SEYO|Bench 23)/i, 'Product'],
  [/^(Bench|Casual Leave|Public Holiday|Mayvel - STP|Marketing 24)/i, 'Others'],
];
const typeFor = (name) => (TYPE_BY_NAME.find(([re]) => re.test(name)) || [null, 'Service'])[1];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dmy = (s) => { const m = String(s || '').match(/(\d{2})[/-](\d{2})[/-](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const num = (s) => Number(String(s || '').replace(/[^0-9.]/g, '')) || 0;

(async () => {
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find({});
  const byName = new Map();
  users.forEach(u => { byName.set(norm(u.name), u); (u.aliases || []).forEach(a => byName.set(norm(a), u)); });
  const findUser = (name) => byName.get(norm(name)) || users.find(u => norm(u.name).startsWith(norm(name).slice(0, 8)) && norm(name).length > 6) || null;
  const unmatched = new Set();
  const report = { costs: 0, costsSkipped: 0, projects: 0, sprints: 0, budgets: 0 };

  // ── Rate card ──
  for (const row of seed.resourceCosts?.rows || []) {
    const [name, type, cost, eff] = row;
    const u = findUser(name); if (!u) { unmatched.add(name); continue; }
    const doc = { userId: u._id.toString(), resourceType: type || 'Member', dailyCost: num(cost), effectiveDate: dmy(eff) || '2024-01-01', createdBy: 'legacy ERP import' };
    if (!DRY) { const r = await ResourceCost.updateOne({ userId: doc.userId, effectiveDate: doc.effectiveDate }, { $setOnInsert: doc }, { upsert: true }); if (r.upsertedCount) report.costs++; else report.costsSkipped++; } else report.costs++;
  }

  // ── Projects (+ manual budget from the legacy master plan, sprints, booking categories) ──
  const listRows = seed.projects?.rows || [];
  const existing = await Project.find({}, 'name');
  for (const d of seed.projectDetails || []) {
    const listRow = listRows.find(r => r[1] === d.name) || [];
    const fields = {
      client: d.owner || listRow[2] || '', startDate: dmy(d.start || listRow[3]), endDate: dmy(d.end || listRow[4]),
      status: (d.status || listRow[5] || 'Active').replace('Inactive', 'InActive'), type: d.type || typeFor(d.name),
      billable: !/bench|leave|holiday/i.test(d.name),
      categories: (d.tasks || []).filter(t => t.IsEnabled !== false).map(t => t.TaskName).filter(Boolean),
    };
    const mgr = d.manager ? findUser(d.manager) : null; if (d.manager && !mgr) unmatched.add(d.manager); if (mgr) fields.managerId = mgr._id.toString();
    const members = (d.members || []).map(n => { const u = findUser(n); if (!u) unmatched.add(n); return u?._id.toString(); }).filter(Boolean); if (members.length) fields.memberIds = members;
    if (!['Active', 'In Progress', 'InActive', 'Completed'].includes(fields.status)) fields.status = 'Active';
    // Match an existing app project first: exact name, else the legacy name starts with an
    // existing project's name (e.g. "Auchan Resource Cost 26-27" → "Auchan"); longest match wins.
    let p = await Project.findOne({ name: d.name });
    if (!p) { const cands = existing.filter(x => norm(x.name).length >= 4 && norm(d.name).startsWith(norm(x.name))).sort((a, b) => b.name.length - a.name.length); p = cands[0] || null; if (p) console.log(`  ↳ "${d.name}" → existing project "${p.name}"`); }
    if (!p) { p = new Project({ name: d.name, description: d.description || d.name, createdBy: 'legacy ERP import', ...fields }); if (!DRY) await p.save(); report.projects++; }
    else { Object.assign(p, fields); if (!DRY) await p.save(); }
    const pid = p._id.toString();
    // approved budget → one approved budget request (so P&L uses it), unless one exists already
    const budget = num(d.budget);
    if (budget > 10 && !(await BudgetRequest.exists({ projectId: pid, remarks: 'Imported from legacy ERP master plan' }))) {
      if (!DRY) await BudgetRequest.create({ projectId: pid, requestDate: fields.startDate || '2026-04-01', cost: budget, startDate: fields.startDate, endDate: fields.endDate, reason: 'Billable Estimate', remarks: 'Imported from legacy ERP master plan', projectApproval: 'Approved', financialApproval: 'Approved', requestedBy: 'legacy ERP import', history: [{ by: 'legacy ERP import', action: 'imported as approved' }] });
      report.budgets++;
    }
    for (const s of d.sprints || []) {
      if (!s.SprintName) continue;
      if (!(await Sprint.exists({ projectId: pid, name: s.SprintName }))) { if (!DRY) await Sprint.create({ name: s.SprintName, goal: s.SprintDescription || '', projectId: pid, status: 'active', startDate: fields.startDate ? new Date(fields.startDate) : undefined, endDate: fields.endDate ? new Date(fields.endDate) : undefined, createdBy: 'legacy ERP import' }); report.sprints++; }
    }
  }
  console.log(`${DRY ? '[dry run] ' : ''}rate-card rows added: ${report.costs} (already present: ${report.costsSkipped}); projects created: ${report.projects}; budgets imported: ${report.budgets}; sprints created: ${report.sprints}`);
  if (unmatched.size) console.log(`\nNo app user matches these ${unmatched.size} legacy names (invite or merge them, then re-run):\n  ` + [...unmatched].sort().join('\n  '));
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
