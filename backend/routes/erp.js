/**
 * ERP module: weekly timesheets + approvals, Profit & Loss, reports and
 * resource management. Everything the legacy "Mayvel Timesheet Management"
 * portal did, served under /api/erp for the new app.
 */
const express = require('express');
const User = require('../models/User');
const Project = require('../models/Project');
const Sprint = require('../models/Sprint');
const OrgChart = require('../models/OrgChart');
const { Task } = require('../models/Task');
const Notification = require('../models/Notification');
const { Timesheet, ResourceCost, PlannedCost, BudgetRequest, Expense, Allocation, Holiday } = require('../models/Erp');

const router = express.Router();
const str = (v) => (typeof v === 'string' ? v : undefined);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pick = (obj, fields) => { const o = {}; for (const f of fields) if (obj[f] !== undefined) o[f] = obj[f]; return o; };

// ─── Date helpers (all local-date strings 'YYYY-MM-DD') ─────────────────────
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monthOf = (s) => s.slice(0, 7);
const todayIso = () => iso(new Date());
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (s) => { const d = fromIso(s); return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`; };

/** Legacy ERP week rule: week 1 = 1 Jan → first Sunday; then Mon–Sun. */
function weeksOf(year) {
  const weeks = [];
  const last = new Date(year, 11, 31);
  let start = new Date(year, 0, 1);
  let n = 1;
  while (start <= last) {
    const dow = start.getDay();
    let end = addDays(start, dow === 0 ? 0 : 7 - dow);
    if (end > last) end = last;
    const monday = addDays(start, dow === 0 ? -6 : 1 - dow);
    const days = Array.from({ length: 7 }, (_, i) => iso(addDays(monday, i)));
    weeks.push({ n, start: iso(start), end: iso(end), days, label: `Week ${n} (${fmtDay(iso(start))} – ${fmtDay(iso(end))} ${year})`, range: `${fmtDay(iso(start))} – ${fmtDay(iso(end))}` });
    start = addDays(end, 1); n++;
  }
  return weeks;
}
function weekFor(dateIso) {
  const y = Number(dateIso.slice(0, 4));
  const w = weeksOf(y).find(x => dateIso >= x.start && dateIso <= x.end);
  return { year: y, week: w.n, ...w };
}
function prevWeek(year, week) {
  if (week > 1) return { year, week: week - 1 };
  return { year: year - 1, week: weeksOf(year - 1).length };
}
/** Last `count` weeks ending with the current one, oldest first. */
function recentWeeks(count = 8) {
  let cur = weekFor(todayIso());
  const out = [];
  for (let i = 0; i < count; i++) { out.unshift({ year: cur.year, week: cur.week }); cur = prevWeek(cur.year, cur.week); }
  return out.map(w => ({ ...w, ...weeksOf(w.year)[w.week - 1] }));
}
function monthsBetween(fromIso, toIso) {
  const out = []; let [y, m] = fromIso.split('-').map(Number); const end = monthOf(toIso);
  while (`${y}-${pad(m)}` <= end) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const monthLabel = (ym) => `${MONTH_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** Indian financial year (Apr–Mar) containing a date. */
function fyOf(dateIso) { const y = Number(dateIso.slice(0, 4)); const m = Number(dateIso.slice(5, 7)); return m >= 4 ? y : y - 1; }
const fyRange = (fy) => ({ from: `${fy}-04-01`, to: `${fy + 1}-03-31` });

// ─── People helpers ──────────────────────────────────────────────────────────
const uid = (u) => u._id.toString();
const isAdmin = (u) => u.role === 'Admin';

async function orgReports(userId) {
  // direct + indirect reports from the global org chart
  const chart = await OrgChart.findOne({ teamspaceId: null });
  if (!chart) return { reports: [], managers: [] };
  const byMember = {}; const byId = {};
  chart.nodes.forEach(n => { byId[n.id] = n; if (n.memberId) byMember[n.memberId] = n; });
  const me = byMember[userId];
  if (!me) return { reports: [], managers: [] };
  const childMap = {}; const parentMap = {};
  chart.edges.forEach(e => { (childMap[e.from] ||= []).push(e.to); parentMap[e.to] = e.from; });
  const reports = []; const stack = [...(childMap[me.id] || [])];
  while (stack.length) { const id = stack.pop(); const n = byId[id]; if (!n) continue; if (n.memberId) reports.push(n.memberId); stack.push(...(childMap[id] || [])); }
  const managers = []; let cur = me.id;
  while (parentMap[cur]) { const p = byId[parentMap[cur]]; if (!p) break; if (p.memberId) managers.push(p.memberId); cur = p.id; }
  return { reports, managers };
}
/** Everyone this user may see/approve: allocation list ∪ org-chart subtree. Admin: everyone. */
async function reportsOf(user) {
  if (isAdmin(user)) return (await User.find({ active: { $ne: false } }, '_id')).map(uid).filter(id => id !== uid(user));
  const set = new Set();
  const alloc = await Allocation.findOne({ managerId: uid(user) });
  (alloc?.userIds || []).forEach(id => set.add(id));
  (await orgReports(uid(user))).reports.forEach(id => set.add(id));
  set.delete(uid(user));
  return [...set];
}
/** Managers who approve this user's sheets: allocation managers ∪ org-chart parent chain. */
async function approversOf(userId) {
  const set = new Set();
  (await Allocation.find({ userIds: userId }, 'managerId')).forEach(a => set.add(a.managerId));
  (await orgReports(userId)).managers.forEach(id => set.add(id));
  return [...set];
}
async function canSeeMoney(user) {
  if (isAdmin(user) || user.role === 'Team Owner') return true;
  if (await Project.exists({ managerId: uid(user) })) return true;
  return (await reportsOf(user)).length > 0;
}
async function nameMap() {
  const users = await User.find({}, 'name');
  return Object.fromEntries(users.map(u => [uid(u), u.name]));
}

// ─── Rate helpers ────────────────────────────────────────────────────────────
async function rateBook() {
  const rows = await ResourceCost.find({}).sort({ effectiveDate: 1 });
  const byUser = {};
  rows.forEach(r => (byUser[r.userId] ||= []).push(r));
  return {
    /** hourly rate in force on a date (daily ÷ 8) */
    hourly(userId, dateIso) { const list = byUser[userId] || []; let hit = null; for (const r of list) { if (r.effectiveDate <= dateIso) hit = r; else break; } return hit ? hit.dailyCost / 8 : 0; },
    type(userId) { const list = byUser[userId] || []; return list.length ? list[list.length - 1].resourceType : ''; },
    daily(userId, dateIso) { return this.hourly(userId, dateIso) * 8; },
  };
}
const workingDays = (ym, holidaySet) => {
  const [y, m] = ym.split('-').map(Number); let c = 0;
  for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d = addDays(d, 1)) { const dow = d.getDay(); if (dow !== 0 && dow !== 6 && !holidaySet.has(iso(d))) c++; }
  return c;
};

// ─── Project budget ──────────────────────────────────────────────────────────
async function budgetsFor(projectIds) {
  const reqs = await BudgetRequest.find({ projectId: { $in: projectIds }, projectApproval: 'Approved', financialApproval: 'Approved' });
  const out = {}; reqs.forEach(r => { out[r.projectId] = (out[r.projectId] || 0) + r.cost; });
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Context
// ═════════════════════════════════════════════════════════════════════════════
router.get('/me', async (req, res) => {
  try {
    const reports = await reportsOf(req.user);
    const names = await nameMap();
    const managers = await approversOf(uid(req.user));
    res.json({
      user: { id: uid(req.user), name: req.user.name, role: req.user.role },
      isAdmin: isAdmin(req.user), isManager: reports.length > 0, canSeeMoney: await canSeeMoney(req.user),
      reports: reports.map(id => ({ _id: id, name: names[id] || '?' })).sort((a, b) => a.name.localeCompare(b.name)),
      managers: managers.map(id => ({ _id: id, name: names[id] || '?' })),
      today: todayIso(), currentWeek: (({ year, week }) => ({ year, week }))(weekFor(todayIso())),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/weeks', (req, res) => {
  const year = num(req.query.year, new Date().getFullYear());
  res.json(weeksOf(year));
});

/** Compliance summary for the header strip: my missing weeks, approvals waiting on me, team members who have not submitted. */
router.get('/summary', async (req, res) => {
  try {
    const me = uid(req.user); const weeks = recentWeeks(8); const names = await nameMap();
    const mine = await Timesheet.find({ userId: me, $or: weeks.map(w => ({ year: w.year, week: w.week })) });
    const myMissing = weeks.filter(w => !mine.some(s => s.year === w.year && s.week === w.week && ['submitted', 'approved'].includes(s.status)));
    const reports = await reportsOf(req.user);
    let approvalPending = [], teamPending = [];
    if (reports.length) {
      const sheets = await Timesheet.find({ userId: { $in: reports }, $or: weeks.map(w => ({ year: w.year, week: w.week })) });
      approvalPending = weeks.map(w => ({ ...w, users: sheets.filter(s => s.year === w.year && s.week === w.week && s.status === 'submitted').map(s => names[s.userId]) })).filter(w => w.users.length);
      teamPending = weeks.map(w => ({ ...w, users: reports.filter(u => !sheets.some(s => s.userId === u && s.year === w.year && s.week === w.week && ['submitted', 'approved'].includes(s.status))).map(u => names[u]) })).filter(w => w.users.length);
    }
    const pct = (ok, total) => (total ? Math.round((ok / total) * 100) : 100);
    res.json({
      weeks: weeks.map(({ year, week, label, range }) => ({ year, week, label, range })),
      gauges: { mine: pct(weeks.length - myMissing.length, weeks.length), approvals: pct(weeks.length - approvalPending.length, weeks.length), team: pct(weeks.length - teamPending.length, weeks.length) },
      myMissing: myMissing.map(({ year, week, label, range }) => ({ year, week, label, range })),
      approvalPending: approvalPending.map(({ year, week, label, range, users }) => ({ year, week, label, range, users })),
      teamPending: teamPending.map(({ year, week, label, range, users }) => ({ year, week, label, range, users })),
      isManager: reports.length > 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// Projects (ERP fields live on the shared Project model)
// ═════════════════════════════════════════════════════════════════════════════
const ERP_PROJECT_FIELDS = ['name', 'description', 'client', 'type', 'status', 'startDate', 'endDate', 'managerId', 'memberIds', 'budget', 'categories', 'billable'];

async function projectsForUser(user) {
  // Members see projects they belong to (or every project when membership is unset); managers/admins see all.
  const all = await Project.find({}).sort({ name: 1 });
  if (isAdmin(user) || user.role === 'Team Owner') return all;
  const me = uid(user);
  const mine = all.filter(p => !p.memberIds?.length || p.memberIds.includes(me) || p.managerId === me);
  return mine;
}

router.get('/projects', async (req, res) => {
  try {
    const all = await Project.find({}).sort({ name: 1 });
    const budgets = await budgetsFor(all.map(p => p._id.toString()));
    const names = await nameMap();
    res.json(all.map(p => ({ ...p.toObject(), budgetApproved: budgets[p._id.toString()] || 0, managerName: names[p.managerId] || '', memberNames: (p.memberIds || []).map(id => names[id]).filter(Boolean) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/projects/:id', async (req, res) => {
  try {
    const p = await Project.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Project not found' });
    if (!(isAdmin(req.user) || req.user.role === 'Team Owner' || p.managerId === uid(req.user))) return res.status(403).json({ message: 'Only the project manager or an admin can edit project setup' });
    Object.assign(p, pick(req.body, ERP_PROJECT_FIELDS));
    await p.save();
    res.json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/projects', async (req, res) => {
  try {
    if (!(isAdmin(req.user) || req.user.role === 'Team Owner')) return res.status(403).json({ message: 'Admin access required' });
    const p = new Project({ ...pick(req.body, ERP_PROJECT_FIELDS), createdBy: req.user.name });
    await p.save(); res.status(201).json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// Timesheets
// ═════════════════════════════════════════════════════════════════════════════
async function loadOrBlank(userId, year, week) {
  const w = weeksOf(year)[week - 1];
  if (!w) throw new Error('Invalid week');
  let sheet = await Timesheet.findOne({ userId, year, week });
  if (!sheet) sheet = new Timesheet({ userId, year, week, days: w.days, rows: [], status: 'draft' });
  return { sheet, w };
}
const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);

/** Planned minus booked minutes per project for a user within the FY of the week. */
async function remainingByProject(userId, dateIso) {
  const fy = fyOf(dateIso); const { from, to } = fyRange(fy);
  const planned = await PlannedCost.find({ userId, month: { $gte: monthOf(from), $lte: monthOf(to) } });
  const plannedMin = {}; planned.forEach(p => { plannedMin[p.projectId] = (plannedMin[p.projectId] || 0) + (p.billableHours + p.nonBillableHours) * 60; });
  const sheets = await Timesheet.find({ userId, status: { $ne: 'rejected' }, days: { $elemMatch: { $gte: from, $lte: to } } });
  const booked = {};
  sheets.forEach(s => s.rows.forEach(r => { r.minutes.forEach((m, i) => { const d = s.days[i]; if (d >= from && d <= to) booked[r.projectId] = (booked[r.projectId] || 0) + (m || 0); }); }));
  const out = {}; new Set([...Object.keys(plannedMin), ...Object.keys(booked)]).forEach(pid => { out[pid] = { plannedMinutes: plannedMin[pid] || 0, bookedMinutes: booked[pid] || 0, remainingMinutes: (plannedMin[pid] || 0) - (booked[pid] || 0) }; });
  return out;
}

router.get('/timesheet', async (req, res) => {
  try {
    const year = num(req.query.year, new Date().getFullYear()); const week = num(req.query.week, weekFor(todayIso()).week);
    let userId = str(req.query.userId) || uid(req.user);
    if (userId !== uid(req.user) && !(await reportsOf(req.user)).includes(userId)) return res.status(403).json({ message: 'Not your report' });
    const target = await User.findById(userId);
    const { sheet, w } = await loadOrBlank(userId, year, week);
    const projects = await projectsForUser(target || req.user);
    const sprints = await Sprint.find({ projectId: { $in: projects.map(p => p._id.toString()) } }, 'name projectId status');
    const remaining = await remainingByProject(userId, w.days[3]);
    res.json({
      week: { year, week, ...w }, sheet, userName: target?.name || req.user.name,
      projects: projects.map(p => ({ _id: p._id, name: p.name, status: p.status, categories: p.categories?.length ? p.categories : Project.DEFAULT_CATEGORIES, sprints: sprints.filter(s => s.projectId === p._id.toString()).map(s => ({ _id: s._id, name: s.name, status: s.status })), ...(remaining[p._id.toString()] || { plannedMinutes: 0, bookedMinutes: 0, remainingMinutes: 0 }) })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const cleanRows = (rows) => (Array.isArray(rows) ? rows : []).filter(r => r && r.projectId).map(r => ({
  projectId: String(r.projectId), sprintId: r.sprintId ? String(r.sprintId) : '', category: r.category ? String(r.category).slice(0, 80) : '',
  minutes: Array.from({ length: 7 }, (_, i) => Math.max(0, Math.min(24 * 60, Math.round(num(r.minutes?.[i]))))),
}));

router.put('/timesheet', async (req, res) => {
  try {
    const year = num(req.body.year); const week = num(req.body.week);
    const userId = str(req.body.userId) || uid(req.user);
    if (userId !== uid(req.user) && !isAdmin(req.user)) return res.status(403).json({ message: 'You can only edit your own timesheet' });
    const { sheet } = await loadOrBlank(userId, year, week);
    if (['submitted', 'approved'].includes(sheet.status) && !isAdmin(req.user)) return res.status(409).json({ message: `This week is ${sheet.status}; ask your manager to reopen it.` });
    sheet.rows = cleanRows(req.body.rows);
    if (sheet.status === 'rejected') sheet.status = 'draft';
    sheet.history.push({ by: req.user.name, action: 'saved' });
    await sheet.save();
    res.json(sheet);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/timesheet/submit', async (req, res) => {
  try {
    const year = num(req.body.year); const week = num(req.body.week); const userId = uid(req.user);
    const { sheet, w } = await loadOrBlank(userId, year, week);
    if (req.body.rows) sheet.rows = cleanRows(req.body.rows);
    if (['submitted', 'approved'].includes(sheet.status)) return res.status(409).json({ message: `Already ${sheet.status}` });
    const total = sum(sheet.rows.map(r => sum(r.minutes)));
    if (!total) return res.status(400).json({ message: 'Add some hours before submitting' });
    sheet.status = 'submitted'; sheet.submittedAt = new Date(); sheet.history.push({ by: req.user.name, action: 'submitted' });
    await sheet.save();
    const approvers = await approversOf(userId); const names = await nameMap();
    for (const a of approvers) {
      await Notification.create({ userId: names[a], actorName: req.user.name, type: 'timesheet_submitted', title: 'Timesheet awaiting approval', message: `${req.user.name} submitted week ${week} (${w.range})` }).catch(() => {});
    }
    res.json(sheet);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/timesheet/copy-previous', async (req, res) => {
  try {
    const year = num(req.body.year); const week = num(req.body.week); const userId = uid(req.user);
    const { sheet } = await loadOrBlank(userId, year, week);
    if (['submitted', 'approved'].includes(sheet.status)) return res.status(409).json({ message: `Already ${sheet.status}` });
    const p = prevWeek(year, week);
    const prev = await Timesheet.findOne({ userId, year: p.year, week: p.week });
    if (!prev || !prev.rows.length) return res.status(404).json({ message: 'No previous week to copy' });
    sheet.rows = prev.rows.map(r => ({ projectId: r.projectId, sprintId: r.sprintId, category: r.category, minutes: [0, 0, 0, 0, 0, 0, 0] }));
    sheet.history.push({ by: req.user.name, action: 'saved', note: 'copied rows from previous week' });
    await sheet.save(); res.json(sheet);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function decide(req, res, action) {
  try {
    const sheet = await Timesheet.findById(req.params.id);
    if (!sheet) return res.status(404).json({ message: 'Timesheet not found' });
    const reports = await reportsOf(req.user);
    if (!reports.includes(sheet.userId)) return res.status(403).json({ message: 'You are not an approver for this person' });
    if (action === 'reopen') { sheet.status = 'draft'; }
    else { if (sheet.status !== 'submitted') return res.status(409).json({ message: `Sheet is ${sheet.status}, not submitted` }); sheet.status = action === 'approve' ? 'approved' : 'rejected'; }
    sheet.decidedAt = new Date(); sheet.decidedBy = req.user.name; sheet.note = str(req.body.note) || '';
    sheet.history.push({ by: req.user.name, action: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reopened', note: sheet.note });
    await sheet.save();
    const owner = await User.findById(sheet.userId);
    if (owner) await Notification.create({ userId: owner.name, actorName: req.user.name, type: `timesheet_${sheet.status}`, title: `Timesheet ${sheet.status}`, message: `${req.user.name} ${sheet.status} your week ${sheet.week}/${sheet.year}${sheet.note ? ': ' + sheet.note : ''}` }).catch(() => {});
    res.json(sheet);
  } catch (err) { res.status(500).json({ error: err.message }); }
}
router.post('/timesheet/:id/approve', (req, res) => decide(req, res, 'approve'));
router.post('/timesheet/:id/reject', (req, res) => decide(req, res, 'reject'));
router.post('/timesheet/:id/reopen', (req, res) => decide(req, res, 'reopen'));

/** Sheets from my reports for a week (any status), with pending weeks list. */
router.get('/approvals', async (req, res) => {
  try {
    const year = num(req.query.year, new Date().getFullYear()); const week = num(req.query.week, weekFor(todayIso()).week);
    const reports = await reportsOf(req.user); const names = await nameMap();
    const projects = await Project.find({}, 'name'); const pn = Object.fromEntries(projects.map(p => [p._id.toString(), p.name]));
    const sprints = await Sprint.find({}, 'name'); const sn = Object.fromEntries(sprints.map(s => [s._id.toString(), s.name]));
    const filterProject = str(req.query.projectId);
    let sheets = await Timesheet.find({ userId: { $in: reports }, year, week }).sort({ userId: 1 });
    if (filterProject) sheets = sheets.filter(s => s.rows.some(r => r.projectId === filterProject));
    const pendingWeeks = await Timesheet.aggregate([{ $match: { userId: { $in: reports }, status: 'submitted' } }, { $group: { _id: { year: '$year', week: '$week' }, count: { $sum: 1 } } }, { $sort: { '_id.year': 1, '_id.week': 1 } }]);
    res.json({
      week: { year, week, ...weeksOf(year)[week - 1] },
      pendingWeeks: pendingWeeks.map(p => ({ year: p._id.year, week: p._id.week, count: p.count })),
      sheets: sheets.map(s => ({ ...s.toObject(), userName: names[s.userId] || '?', rows: s.rows.map(r => ({ ...r.toObject(), projectName: pn[r.projectId] || '(deleted project)', sprintName: sn[r.sprintId] || '' })), totalMinutes: sum(s.rows.map(r => sum(r.minutes))) })),
      notSubmitted: reports.filter(u => !sheets.some(s => s.userId === u)).map(u => names[u]).filter(Boolean),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Backlog of everything still waiting for approval (mine, or all when admin). */
router.get('/pending', async (req, res) => {
  try {
    const reports = await reportsOf(req.user); const names = await nameMap();
    const sheets = await Timesheet.find({ userId: { $in: reports }, status: 'submitted' }).sort({ submittedAt: 1 });
    const out = [];
    for (const s of sheets) {
      const approvers = await approversOf(s.userId);
      const w = weeksOf(s.year)[s.week - 1];
      out.push({ _id: s._id, userId: s.userId, userName: names[s.userId], year: s.year, week: s.week, range: w?.range, submittedAt: s.submittedAt, totalMinutes: sum(s.rows.map(r => sum(r.minutes))), daysWaiting: s.submittedAt ? Math.floor((Date.now() - s.submittedAt) / 86400000) : 0, approvers: approvers.map(a => names[a]).filter(Boolean) });
    }
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/my-dashboard', async (req, res) => {
  try {
    const weeks = recentWeeks(8); const me = uid(req.user);
    const sheets = await Timesheet.find({ userId: me, $or: weeks.map(w => ({ year: w.year, week: w.week })) });
    res.json(weeks.map(w => { const s = sheets.find(x => x.year === w.year && x.week === w.week); return { year: w.year, week: w.week, range: w.range, minutes: s ? sum(s.rows.map(r => sum(r.minutes))) : 0, status: s?.status || 'missing' }; }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/team-dashboard', async (req, res) => {
  try {
    const weeks = recentWeeks(8); const names = await nameMap();
    let people = await reportsOf(req.user);
    if (req.query.all === '1' && isAdmin(req.user)) people = (await User.find({ active: { $ne: false } }, '_id')).map(uid);
    const sheets = await Timesheet.find({ userId: { $in: people }, $or: weeks.map(w => ({ year: w.year, week: w.week })) });
    const rows = [];
    for (const u of people) {
      const approvers = (await approversOf(u)).map(a => names[a]).filter(Boolean);
      for (const w of weeks) {
        const s = sheets.find(x => x.userId === u && x.year === w.year && x.week === w.week);
        const minutes = s ? sum(s.rows.map(r => sum(r.minutes))) : 0;
        rows.push({ userId: u, userName: names[u], year: w.year, week: w.week, range: w.range, keyedIn: minutes > 0, minutes, status: s?.status || 'missing', approvers, sheetId: s?._id });
      }
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// Profit & Loss
// ═════════════════════════════════════════════════════════════════════════════
const LOGGED = ['submitted', 'approved'];

/**
 * Core P&L engine for a set of projects in [from,to].
 * Returns per project → per user → per month: planned / actual / toBeSpent hours & cost.
 */
async function computePl(projectIds, from, to) {
  const months = monthsBetween(from, to); const rates = await rateBook(); const names = await nameMap();
  const curMonth = monthOf(todayIso());
  const planned = await PlannedCost.find({ projectId: { $in: projectIds }, month: { $gte: months[0], $lte: months[months.length - 1] } });
  const sheets = await Timesheet.find({ status: { $in: LOGGED }, days: { $elemMatch: { $gte: from, $lte: to } }, 'rows.projectId': { $in: projectIds } });
  const expenses = await Expense.find({ projectId: { $in: projectIds }, date: { $gte: from, $lte: to } });
  const budgets = await budgetsFor(projectIds);
  const cell = () => ({ hours: 0, cost: 0 });
  const out = {};
  const bucket = (pid, uidv, m) => { const p = (out[pid] ||= { users: {}, expenses: { Actual: 0, Planned: 0, 'To Be Spent': 0 }, budget: budgets[pid] || 0 }); const u = (p.users[uidv] ||= { userId: uidv, name: names[uidv] || '?', type: rates.type(uidv), planned: {}, actual: {}, toBeSpent: {} }); u.planned[m] ||= cell(); u.actual[m] ||= cell(); u.toBeSpent[m] ||= cell(); return u; };
  projectIds.forEach(pid => { out[pid] ||= { users: {}, expenses: { Actual: 0, Planned: 0, 'To Be Spent': 0 }, budget: budgets[pid] || 0 }; });
  planned.forEach(p => { const u = bucket(p.projectId, p.userId, p.month); const h = p.billableHours + p.nonBillableHours; u.planned[p.month].hours += h; u.planned[p.month].cost += h * rates.hourly(p.userId, p.month + '-01'); });
  sheets.forEach(s => s.rows.forEach(r => { if (!projectIds.includes(r.projectId)) return; r.minutes.forEach((min, i) => { const d = s.days[i]; if (!min || d < from || d > to) return; const m = monthOf(d); const u = bucket(r.projectId, s.userId, m); const h = min / 60; u.actual[m].hours += h; u.actual[m].cost += h * rates.hourly(s.userId, d); }); }));
  // to be spent: unconsumed plan in current and future months
  Object.values(out).forEach(p => Object.values(p.users).forEach(u => months.forEach(m => { if (m < curMonth) return; const ph = u.planned[m]?.hours || 0; const ah = u.actual[m]?.hours || 0; const rem = Math.max(0, ph - ah); u.toBeSpent[m] ||= cell(); u.toBeSpent[m].hours += rem; u.toBeSpent[m].cost += rem * rates.hourly(u.userId, m + '-01'); })));
  expenses.forEach(e => { out[e.projectId].expenses[e.planType] += e.amount; });
  // totals
  const tot = (obj) => Object.values(obj).reduce((a, c) => ({ hours: a.hours + c.hours, cost: a.cost + c.cost }), { hours: 0, cost: 0 });
  Object.values(out).forEach(p => {
    p.users = Object.values(p.users).map(u => ({ ...u, totals: { planned: tot(u.planned), actual: tot(u.actual), toBeSpent: tot(u.toBeSpent) } })).sort((a, b) => a.name.localeCompare(b.name));
    const agg = (k) => p.users.reduce((a, u) => ({ hours: a.hours + u.totals[k].hours, cost: a.cost + u.totals[k].cost }), { hours: 0, cost: 0 });
    p.totals = { planned: agg('planned'), actual: agg('actual'), toBeSpent: agg('toBeSpent') };
    p.actualSpent = p.totals.actual.cost + p.expenses.Actual;
    p.toBeSpentTotal = p.totals.toBeSpent.cost + p.expenses['To Be Spent'];
    p.projected = p.actualSpent + p.toBeSpentTotal;
    p.pl = p.budget - p.projected; p.plPct = p.budget ? (p.pl / p.budget) * 100 : 0;
  });
  return { months, out };
}

router.get('/pl/summary', async (req, res) => {
  try {
    if (!(await canSeeMoney(req.user))) return res.status(403).json({ message: 'Profit & Loss is limited to managers and admins' });
    const fy = fyOf(todayIso()); const from = str(req.query.from) || fyRange(fy).from; const to = str(req.query.to) || fyRange(fy).to;
    const types = str(req.query.types)?.split(',').filter(Boolean); const statuses = str(req.query.statuses)?.split(',').filter(Boolean);
    let projects = await Project.find({}).sort({ name: 1 });
    if (types?.length) projects = projects.filter(p => types.includes(p.type || 'Others'));
    if (statuses?.length) projects = projects.filter(p => statuses.includes(p.status || 'Active'));
    const ids = projects.map(p => p._id.toString());
    const { out } = await computePl(ids, from, to);
    res.json({ from, to, rows: projects.map(p => { const r = out[p._id.toString()]; return { projectId: p._id, name: p.name, type: p.type || 'Others', status: p.status || 'Active', budget: r.budget, actualSpent: r.actualSpent, toBeSpent: r.toBeSpentTotal, projected: r.projected, pl: r.pl, plPct: r.plPct, hours: r.totals.actual.hours }; }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pl/project/:id', async (req, res) => {
  try {
    if (!(await canSeeMoney(req.user))) return res.status(403).json({ message: 'Profit & Loss is limited to managers and admins' });
    const p = await Project.findById(req.params.id); if (!p) return res.status(404).json({ message: 'Project not found' });
    const fy = fyOf(p.startDate || todayIso()); const from = str(req.query.from) || p.startDate || fyRange(fy).from; const to = str(req.query.to) || p.endDate || fyRange(fy).to;
    const { months, out } = await computePl([p._id.toString()], from, to);
    res.json({ project: p, from, to, months, monthLabels: months.map(monthLabel), ...out[p._id.toString()] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Planned-cost grid for a project's financial year: every project member × month. */
router.get('/pl/planned/:projectId', async (req, res) => {
  try {
    if (!(await canSeeMoney(req.user))) return res.status(403).json({ message: 'Limited to managers and admins' });
    const p = await Project.findById(req.params.projectId); if (!p) return res.status(404).json({ message: 'Project not found' });
    const from = str(req.query.from) || p.startDate || fyRange(fyOf(todayIso())).from; const to = str(req.query.to) || p.endDate || fyRange(fyOf(from)).to;
    const months = monthsBetween(from, to); const rates = await rateBook(); const names = await nameMap();
    const holidays = new Set((await Holiday.find({})).map(h => h.date));
    const rows = await PlannedCost.find({ projectId: p._id.toString(), month: { $in: months } });
    const { out } = await computePl([p._id.toString()], from, to); const actual = out[p._id.toString()];
    const userIds = [...new Set([...(p.memberIds || []), ...(p.managerId ? [p.managerId] : []), ...rows.map(r => r.userId)])];
    res.json({
      project: { _id: p._id, name: p.name }, from, to, months, monthLabels: months.map(monthLabel),
      workingDays: Object.fromEntries(months.map(m => [m, workingDays(m, holidays)])),
      rows: userIds.map(u => ({ userId: u, name: names[u] || '?', type: rates.type(u), rates: Object.fromEntries(months.map(m => [m, rates.hourly(u, m + '-01')])),
        cells: Object.fromEntries(months.map(m => { const r = rows.find(x => x.userId === u && x.month === m); const a = actual.users.find(x => x.userId === u)?.actual[m]; return [m, { billableHours: r?.billableHours || 0, nonBillableHours: r?.nonBillableHours || 0, actualHours: a?.hours || 0, actualCost: a?.cost || 0 }]; })) })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/pl/planned/:projectId', async (req, res) => {
  try {
    const p = await Project.findById(req.params.projectId); if (!p) return res.status(404).json({ message: 'Project not found' });
    if (!(isAdmin(req.user) || req.user.role === 'Team Owner' || p.managerId === uid(req.user))) return res.status(403).json({ message: 'Only the project manager or an admin can plan cost' });
    const cells = Array.isArray(req.body.cells) ? req.body.cells : [];
    for (const c of cells) {
      if (!c.userId || !/^\d{4}-\d{2}$/.test(c.month || '')) continue;
      await PlannedCost.findOneAndUpdate({ projectId: p._id.toString(), userId: String(c.userId), month: c.month }, { billableHours: Math.max(0, num(c.billableHours)), nonBillableHours: Math.max(0, num(c.nonBillableHours)) }, { upsert: true });
    }
    res.json({ ok: true, saved: cells.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Budget requests
router.get('/pl/budget/:projectId', async (req, res) => {
  try { res.json(await BudgetRequest.find({ projectId: req.params.projectId }).sort({ requestDate: 1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/pl/budget/:projectId', async (req, res) => {
  try {
    const p = await Project.findById(req.params.projectId); if (!p) return res.status(404).json({ message: 'Project not found' });
    const r = new BudgetRequest({ ...pick(req.body, ['requestDate', 'cost', 'startDate', 'endDate', 'reason', 'remarks']), projectId: p._id.toString(), requestedBy: req.user.name, history: [{ by: req.user.name, action: 'submitted' }] });
    await r.save();
    const approvers = p.managerId ? await approversOf(p.managerId) : []; const names = await nameMap();
    for (const a of approvers) await Notification.create({ userId: names[a], actorName: req.user.name, type: 'budget_request', title: 'Budget request to approve', message: `${req.user.name} requested ₹${r.cost} for ${p.name}` }).catch(() => {});
    res.status(201).json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/pl/budget/:id/decide', async (req, res) => {
  try {
    if (!(await canSeeMoney(req.user))) return res.status(403).json({ message: 'Only managers and admins can approve budgets' });
    const r = await BudgetRequest.findById(req.params.id); if (!r) return res.status(404).json({ message: 'Request not found' });
    const stage = req.body.stage === 'financial' ? 'financialApproval' : 'projectApproval'; const decision = req.body.decision === 'Rejected' ? 'Rejected' : 'Approved';
    if (stage === 'financialApproval' && !isAdmin(req.user) && req.user.role !== 'Team Owner') return res.status(403).json({ message: 'Financial approval is for admins' });
    r[stage] = decision; r.history.push({ by: req.user.name, action: `${stage === 'projectApproval' ? 'project' : 'financial'} ${decision.toLowerCase()}`, note: str(req.body.note) || '' });
    if (stage === 'projectApproval' && decision === 'Approved' && r.financialApproval === 'Pending' && isAdmin(req.user)) { r.financialApproval = 'Approved'; r.history.push({ by: 'System', action: 'financial approved', note: 'auto-approved: admin approval covers both levels' }); }
    await r.save(); res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/pl/budget/:id', async (req, res) => {
  try { if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' }); await BudgetRequest.findByIdAndDelete(req.params.id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Expenses
router.get('/pl/expenses', async (req, res) => {
  try {
    const f = {}; if (str(req.query.projectId)) f.projectId = req.query.projectId; if (str(req.query.planType)) f.planType = req.query.planType;
    if (str(req.query.from) || str(req.query.to)) f.date = { ...(str(req.query.from) ? { $gte: req.query.from } : {}), ...(str(req.query.to) ? { $lte: req.query.to } : {}) };
    const rows = await Expense.find(f).sort({ date: -1 }); const projects = await Project.find({}, 'name'); const pn = Object.fromEntries(projects.map(p => [p._id.toString(), p.name]));
    res.json(rows.map(r => ({ ...r.toObject(), projectName: pn[r.projectId] || '' })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/pl/expenses', async (req, res) => {
  try { const e = new Expense({ ...pick(req.body, ['projectId', 'date', 'expenseType', 'planType', 'amount', 'note']), createdBy: req.user.name }); await e.save(); res.status(201).json(e); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/pl/expenses/:id', async (req, res) => {
  try { const e = await Expense.findById(req.params.id); if (!e) return res.status(404).json({ message: 'Not found' }); if (e.createdBy !== req.user.name && !isAdmin(req.user)) return res.status(403).json({ message: 'Not yours' }); await e.deleteOne(); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// Reports
// ═════════════════════════════════════════════════════════════════════════════
router.get('/reports/work-done', async (req, res) => {
  try {
    const from = str(req.query.from); const to = str(req.query.to); if (!from || !to) return res.status(400).json({ message: 'from and to are required' });
    const reports = await reportsOf(req.user); const people = [...reports, uid(req.user)];
    let userIds = str(req.query.userId) ? [req.query.userId] : people; userIds = userIds.filter(u => people.includes(u));
    const names = await nameMap(); const projects = await Project.find({}, 'name'); const pn = Object.fromEntries(projects.map(p => [p._id.toString(), p.name])); const sprints = await Sprint.find({}, 'name'); const sn = Object.fromEntries(sprints.map(s => [s._id.toString(), s.name]));
    const sheets = await Timesheet.find({ userId: { $in: userIds }, days: { $elemMatch: { $gte: from, $lte: to } } }).sort({ year: 1, week: 1 });
    const rows = [];
    sheets.forEach(s => s.rows.forEach(r => { if (str(req.query.projectId) && r.projectId !== req.query.projectId) return; const cells = s.days.map((d, i) => (d >= from && d <= to ? r.minutes[i] || 0 : 0)); const total = sum(cells); if (!total) return; rows.push({ userId: s.userId, userName: names[s.userId], year: s.year, week: s.week, days: s.days, cells, total, projectName: pn[r.projectId] || '', sprintName: sn[r.sprintId] || '', category: r.category, status: s.status }); }));
    res.json({ from, to, rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/compliance', async (req, res) => {
  try {
    const year = num(req.query.year, new Date().getFullYear()); const month = num(req.query.month, new Date().getMonth() + 1); const ym = `${year}-${pad(month)}`;
    const names = await nameMap(); const holidays = new Set((await Holiday.find({})).map(h => h.date));
    let people = req.query.scope === 'me' ? [uid(req.user)] : await reportsOf(req.user); if (!people.length) people = [uid(req.user)];
    const daysInMonth = new Date(year, month, 0).getDate(); const days = Array.from({ length: daysInMonth }, (_, i) => `${ym}-${pad(i + 1)}`); const today = todayIso();
    const sheets = await Timesheet.find({ userId: { $in: people }, days: { $elemMatch: { $gte: days[0], $lte: days[days.length - 1] } } });
    const rows = people.map(u => {
      const logged = new Set(); sheets.filter(s => s.userId === u).forEach(s => s.days.forEach((d, i) => { if (s.rows.some(r => r.minutes[i] > 0)) logged.add(d); }));
      let present = 0, missing = 0, working = 0;
      const cells = days.map(d => { const dow = fromIso(d).getDay(); if (dow === 0 || dow === 6 || holidays.has(d)) return 'H'; if (d > today) return ''; working++; if (logged.has(d)) { present++; return 'P'; } missing++; return 'M'; });
      return { userId: u, userName: names[u], present, working, missing, pct: working ? Math.round((present / working) * 100) : 100, cells };
    }).sort((a, b) => a.userName.localeCompare(b.userName));
    res.json({ year, month, days, rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Budget vs actual in hours: mine (per project) or a project's (per person). */
router.get('/reports/budget-vs-actual', async (req, res) => {
  try {
    const fy = fyOf(todayIso()); const from = str(req.query.from) || fyRange(fy).from; const to = str(req.query.to) || fyRange(fy).to; const months = monthsBetween(from, to);
    const names = await nameMap(); const projects = await Project.find({}, 'name'); const pn = Object.fromEntries(projects.map(p => [p._id.toString(), p.name]));
    const projectId = str(req.query.projectId); const unit = req.query.unit === 'amount' ? 'amount' : 'hours'; const rates = unit === 'amount' ? await rateBook() : null;
    if (projectId && !(await canSeeMoney(req.user)) && unit === 'amount') return res.status(403).json({ message: 'Amounts are limited to managers' });
    const me = uid(req.user);
    const filter = projectId ? { projectId } : { userId: me };
    const planned = await PlannedCost.find({ ...filter, month: { $in: months } });
    const sheets = await Timesheet.find({ status: { $ne: 'rejected' }, days: { $elemMatch: { $gte: from, $lte: to } }, ...(projectId ? { 'rows.projectId': projectId } : { userId: me }) });
    const key = projectId ? (x) => x.userId : (x) => x.projectId; const label = projectId ? (k) => names[k] || '?' : (k) => pn[k] || '(deleted project)';
    const rows = {}; const cell = () => ({ planned: 0, used: 0 });
    const val = (u, ym, hours) => (unit === 'amount' ? hours * rates.hourly(u, ym + '-01') : hours);
    planned.forEach(p => { const k = key(p); (rows[k] ||= {}); (rows[k][p.month] ||= cell()).planned += val(p.userId, p.month, p.billableHours + p.nonBillableHours); });
    sheets.forEach(s => s.rows.forEach(r => { if (projectId && r.projectId !== projectId) return; r.minutes.forEach((m, i) => { const d = s.days[i]; if (!m || d < from || d > to) return; const k = projectId ? s.userId : r.projectId; const ym = monthOf(d); (rows[k] ||= {}); (rows[k][ym] ||= cell()).used += val(s.userId, d, m / 60); }); }));
    res.json({ from, to, months, monthLabels: months.map(monthLabel), unit, rows: Object.entries(rows).map(([k, cells]) => { const t = { planned: 0, used: 0 }; Object.values(cells).forEach(c => { t.planned += c.planned; t.used += c.used; }); return { key: k, label: label(k), cells, totals: { ...t, remaining: t.planned - t.used } }; }).sort((a, b) => a.label.localeCompare(b.label)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// Resources: allocation, rate card, holidays, hierarchy
// ═════════════════════════════════════════════════════════════════════════════
router.get('/resources/allocations', async (req, res) => {
  try { const names = await nameMap(); const rows = await Allocation.find({}); res.json(rows.map(a => ({ managerId: a.managerId, managerName: names[a.managerId] || '?', userIds: a.userIds, userNames: a.userIds.map(u => names[u]).filter(Boolean) }))); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/resources/allocations/:managerId', async (req, res) => {
  try {
    if (!(isAdmin(req.user) || req.user.role === 'Team Owner' || req.params.managerId === uid(req.user))) return res.status(403).json({ message: 'Admins, or the manager themselves, can change allocation' });
    const userIds = (Array.isArray(req.body.userIds) ? req.body.userIds : []).map(String).filter(u => u !== req.params.managerId);
    const a = await Allocation.findOneAndUpdate({ managerId: req.params.managerId }, { userIds }, { upsert: true, new: true }); res.json(a);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/resources/costs', async (req, res) => {
  try {
    if (!(await canSeeMoney(req.user))) return res.status(403).json({ message: 'The rate card is limited to managers and admins' });
    const names = await nameMap(); const rows = await ResourceCost.find({}).sort({ effectiveDate: -1 });
    res.json(rows.map(r => ({ ...r.toObject(), userName: names[r.userId] || '?' })).sort((a, b) => a.userName.localeCompare(b.userName) || (a.effectiveDate < b.effectiveDate ? 1 : -1)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/resources/costs', async (req, res) => {
  try { if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' }); const r = new ResourceCost({ ...pick(req.body, ['userId', 'resourceType', 'dailyCost', 'effectiveDate']), createdBy: req.user.name }); await r.save(); res.status(201).json(r); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/resources/costs/:id', async (req, res) => {
  try { if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' }); await ResourceCost.findByIdAndDelete(req.params.id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/resources/holidays', async (req, res) => {
  try { const y = str(req.query.year); res.json(await Holiday.find(y ? { date: { $regex: `^${y}-` } } : {}).sort({ date: 1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/resources/holidays', async (req, res) => {
  try { if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' }); const h = await Holiday.findOneAndUpdate({ date: str(req.body.date) }, { name: str(req.body.name) || 'Holiday' }, { upsert: true, new: true }); res.status(201).json(h); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/resources/holidays/:id', async (req, res) => {
  try { if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' }); await Holiday.findByIdAndDelete(req.params.id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/resources/hierarchy', async (req, res) => {
  try {
    const chart = await OrgChart.findOne({ teamspaceId: null }); const users = await User.find({ active: { $ne: false } }, 'name profilePictureUrl');
    const pic = Object.fromEntries(users.map(u => [uid(u), u.profilePictureUrl]));
    if (!chart) return res.json({ roots: [] });
    const childMap = {}; const hasParent = new Set(); chart.edges.forEach(e => { (childMap[e.from] ||= []).push(e.to); hasParent.add(e.to); });
    const byId = Object.fromEntries(chart.nodes.map(n => [n.id, n]));
    const build = (id, depth = 0) => { const n = byId[id]; if (!n || depth > 12) return null; return { id: n.id, name: n.name, role: n.orgRole, department: n.department, memberId: n.memberId, avatar: pic[n.memberId] || null, children: (childMap[id] || []).map(c => build(c, depth + 1)).filter(Boolean) }; };
    res.json({ roots: chart.nodes.filter(n => !hasParent.has(n.id)).map(n => build(n.id)).filter(Boolean) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// Employee KPI dashboard
// ═════════════════════════════════════════════════════════════════════════════
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const KPI_WEIGHTS = { delivery: 0.25, compliance: 0.2, submission: 0.15, utilisation: 0.15, accuracy: 0.15, quality: 0.1 };
const gradeOf = (s) => (s == null ? '—' : s >= 85 ? 'A' : s >= 70 ? 'B' : s >= 50 ? 'C' : 'D');

/**
 * Per-person KPIs for a period: delivery (tasks), discipline (timesheets),
 * utilisation (hours vs capacity and plan) and a weighted score.
 *   scope=me | team (me + my reports, default) | all (admin)
 */
router.get('/kpi', async (req, res) => {
  try {
    const today = todayIso();
    const from = str(req.query.from) || today.slice(0, 8) + '01';
    const to = str(req.query.to) || today;
    const upto = to < today ? to : today;
    const scope = str(req.query.scope) || 'team';
    let people = scope === 'me' ? [uid(req.user)] : [uid(req.user), ...(await reportsOf(req.user))];
    if (scope === 'all' && isAdmin(req.user)) people = (await User.find({ active: { $ne: false } }, '_id')).map(uid);
    people = [...new Set(people)];
    const users = await User.find({ _id: { $in: people } }, 'name aliases profilePictureUrl');
    const nameToUid = new Map();
    users.forEach(u => { nameToUid.set(u.name.trim().toLowerCase(), uid(u)); (u.aliases || []).forEach(a => nameToUid.set(String(a).trim().toLowerCase(), uid(u))); });
    const ownerOf = (assignee) => nameToUid.get(String(assignee || '').split(',')[0].trim().toLowerCase());

    const holidays = new Set((await Holiday.find({})).map(h => h.date));
    let workingDays = 0; for (let d = fromIso(from); iso(d) <= upto; d = addDays(d, 1)) { const dow = d.getDay(); if (dow !== 0 && dow !== 6 && !holidays.has(iso(d))) workingDays++; }
    const capacityMinutes = workingDays * 8 * 60;

    const tasks = await Task.find({ assignee: { $in: [...nameToUid.keys()].map(n => new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(,|$)', 'i')) } }, 'assignee status dueDate completedAt createdDate estimatedHours actualHours priority');
    const sheets = await Timesheet.find({ userId: { $in: people }, days: { $elemMatch: { $gte: from, $lte: to } } });
    const projects = await Project.find({}, 'billable'); const billable = Object.fromEntries(projects.map(p => [p._id.toString(), p.billable !== false]));
    const months = monthsBetween(from, to);
    const planned = await PlannedCost.find({ userId: { $in: people }, month: { $in: months } });
    // weeks that ended inside the period (and before today) → submission discipline
    const dueWeeks = []; for (let y = Number(from.slice(0, 4)); y <= Number(upto.slice(0, 4)); y++) weeksOf(y).forEach(w => { if (w.end >= from && w.end <= upto) dueWeeks.push({ year: y, week: w.n, end: w.end }); });
    const recent = recentWeeks(8);
    const recentSheets = await Timesheet.find({ userId: { $in: people }, $or: recent.map(w => ({ year: w.year, week: w.week })) }, 'userId year week rows');

    const rows = users.map(u => {
      const id = uid(u);
      const mine = tasks.filter(t => ownerOf(t.assignee) === id);
      const doneDate = (t) => (t.completedAt || t.dueDate || t.createdDate) ? iso(new Date(t.completedAt || t.dueDate || t.createdDate)) : null;
      const completed = mine.filter(t => t.status === 'Completed' && doneDate(t) >= from && doneDate(t) <= to);
      const rejected = mine.filter(t => t.status === 'Rejected' && doneDate(t) >= from && doneDate(t) <= to);
      const open = mine.filter(t => !['Completed', 'Rejected'].includes(t.status));
      const overdue = open.filter(t => t.dueDate && iso(new Date(t.dueDate)) < today);
      const inReview = open.filter(t => t.status === 'In Review').length;
      // Only tasks with a completion stamp can be judged on time; legacy tasks (no stamp) are excluded from this KPI.
      const withDue = completed.filter(t => t.dueDate && t.completedAt);
      const onTime = withDue.filter(t => iso(new Date(t.completedAt)) <= iso(new Date(t.dueDate))).length;
      const tracked = completed.filter(t => t.completedAt).length;
      const est = completed.filter(t => t.estimatedHours > 0 && t.actualHours > 0);
      const estSum = est.reduce((a, t) => a + t.estimatedHours, 0); const actSum = est.reduce((a, t) => a + t.actualHours, 0);
      const ratio = est.length ? actSum / estSum : null;

      const my = sheets.filter(s => s.userId === id && s.status !== 'rejected');
      let logged = 0, billableMin = 0, approvedMin = 0; const daysLogged = new Set();
      my.forEach(s => s.rows.forEach(r => r.minutes.forEach((m, i) => { const d = s.days[i]; if (!m || d < from || d > to) return; logged += m; if (billable[r.projectId] !== false) billableMin += m; if (s.status === 'approved') approvedMin += m; daysLogged.add(d); })));
      let present = 0; daysLogged.forEach(d => { if (d <= upto) present++; });
      const submittedWeeks = dueWeeks.filter(w => my.some(s => s.year === w.year && s.week === w.week && ['submitted', 'approved'].includes(s.status)));
      const promptWeeks = submittedWeeks.filter(w => { const s = my.find(x => x.year === w.year && x.week === w.week); return s?.submittedAt && iso(new Date(s.submittedAt)) <= iso(addDays(fromIso(w.end), 3)); });
      const decided = sheets.filter(s => s.userId === id && ['approved', 'rejected'].includes(s.status));
      const plannedHours = planned.filter(p => p.userId === id).reduce((a, p) => a + p.billableHours + p.nonBillableHours, 0);
      const weekly = recent.map(w => { const s = recentSheets.find(x => x.userId === id && x.year === w.year && x.week === w.week); return { week: w.week, range: w.range, minutes: s ? sum(s.rows.map(r => sum(r.minutes))) : 0 }; });

      const k = {
        delivery: pct(onTime, withDue.length),
        compliance: pct(present, workingDays),
        submission: pct(promptWeeks.length, dueWeeks.length),
        utilisation: capacityMinutes ? clamp(Math.round((logged / capacityMinutes) * 100), 0, 100) : null,
        accuracy: ratio == null ? null : clamp(Math.round(100 - Math.abs(1 - ratio) * 100), 0, 100),
        quality: pct(completed.length, completed.length + rejected.length),
      };
      let wsum = 0, acc = 0; Object.entries(KPI_WEIGHTS).forEach(([key, w]) => { if (k[key] != null) { wsum += w; acc += w * k[key]; } });
      const score = wsum ? Math.round(acc / wsum) : null;
      return {
        userId: id, name: u.name, avatar: u.profilePictureUrl || null, score, grade: gradeOf(score), components: k,
        tasks: { completed: completed.length, onTime, withDue: withDue.length, tracked, open: open.length, overdue: overdue.length, inReview, rejected: rejected.length, estimatedHours: estSum, actualHours: actSum, ratio },
        time: { loggedMinutes: logged, billableMinutes: billableMin, approvedMinutes: approvedMin, billablePct: pct(billableMin, logged), presentDays: present, workingDays, capacityMinutes, submittedWeeks: submittedWeeks.length, promptWeeks: promptWeeks.length, dueWeeks: dueWeeks.length, approvedSheets: decided.filter(s => s.status === 'approved').length, rejectedSheets: decided.filter(s => s.status === 'rejected').length, plannedHours, planUsedPct: plannedHours ? Math.round((logged / 60 / plannedHours) * 100) : null },
        weekly,
      };
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));

    const avg = (arr) => { const v = arr.filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    res.json({
      from, to, workingDays, scope, weights: KPI_WEIGHTS,
      team: { people: rows.length, avgScore: avg(rows.map(r => r.score)), onTime: pct(rows.reduce((a, r) => a + r.tasks.onTime, 0), rows.reduce((a, r) => a + r.tasks.withDue, 0)), completed: rows.reduce((a, r) => a + r.tasks.completed, 0), overdue: rows.reduce((a, r) => a + r.tasks.overdue, 0), loggedMinutes: rows.reduce((a, r) => a + r.time.loggedMinutes, 0), compliance: avg(rows.map(r => r.components.compliance)), utilisation: avg(rows.map(r => r.components.utilisation)), billablePct: pct(rows.reduce((a, r) => a + r.time.billableMinutes, 0), rows.reduce((a, r) => a + r.time.loggedMinutes, 0)) },
      rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
