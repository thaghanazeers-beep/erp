const mongoose = require('mongoose');
const { Schema } = mongoose;

// ─── Weekly timesheet ────────────────────────────────────────────────────────
// One document per person per (year, week). Weeks follow the legacy ERP rule:
// week 1 starts on 1 Jan and ends on the first Sunday; every later week is
// Monday–Sunday. `days` holds the seven ISO dates (Mon..Sun) of the grid and
// each row keeps minutes per day in the same order.
const timesheetRowSchema = new Schema({
  projectId: { type: String, required: true },
  sprintId:  { type: String, default: '' },
  category:  { type: String, default: '' },     // booking category (legacy "task")
  minutes:   { type: [Number], default: () => [0, 0, 0, 0, 0, 0, 0] },
}, { _id: false });

const historySchema = new Schema({
  at:     { type: Date, default: Date.now },
  by:     { type: String, default: '' },
  action: { type: String, default: '' },        // saved | submitted | approved | rejected | reopened
  note:   { type: String, default: '' },
}, { _id: false });

const timesheetSchema = new Schema({
  userId:      { type: String, required: true, index: true },
  year:        { type: Number, required: true },
  week:        { type: Number, required: true },
  days:        { type: [String], default: [] },  // 7 × 'YYYY-MM-DD'
  rows:        { type: [timesheetRowSchema], default: [] },
  status:      { type: String, enum: ['draft', 'submitted', 'approved', 'rejected'], default: 'draft' },
  submittedAt: { type: Date },
  decidedAt:   { type: Date },
  decidedBy:   { type: String, default: '' },
  note:        { type: String, default: '' },    // last approve/reject note
  history:     { type: [historySchema], default: [] },
}, { timestamps: true });
timesheetSchema.index({ userId: 1, year: 1, week: 1 }, { unique: true });

// ─── Rate card ───────────────────────────────────────────────────────────────
// Daily cost per employee with an effective date; the rate in force on a day is
// the latest entry whose effectiveDate is on or before it. Hourly = daily / 8.
const resourceCostSchema = new Schema({
  userId:        { type: String, required: true, index: true },
  resourceType:  { type: String, default: 'Member' },   // Trainee / Junior / Associate / Senior / Management …
  dailyCost:     { type: Number, required: true },
  effectiveDate: { type: String, required: true },      // 'YYYY-MM-DD'
  createdBy:     { type: String, default: '' },
}, { timestamps: true });

// ─── Planned cost grid ───────────────────────────────────────────────────────
// Billable / non-billable hours planned per person per project per month.
const plannedCostSchema = new Schema({
  projectId:        { type: String, required: true, index: true },
  userId:           { type: String, required: true },
  month:            { type: String, required: true },   // 'YYYY-MM'
  billableHours:    { type: Number, default: 0 },
  nonBillableHours: { type: Number, default: 0 },
}, { timestamps: true });
plannedCostSchema.index({ projectId: 1, userId: 1, month: 1 }, { unique: true });

// ─── Budget requests (Project Master Plan) ───────────────────────────────────
const budgetRequestSchema = new Schema({
  projectId:         { type: String, required: true, index: true },
  requestDate:       { type: String, default: () => new Date().toISOString().slice(0, 10) },
  cost:              { type: Number, required: true },
  startDate:         { type: String, default: '' },
  endDate:           { type: String, default: '' },
  reason:            { type: String, default: 'Billable Estimate' },
  remarks:           { type: String, default: '' },
  projectApproval:   { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  financialApproval: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  requestedBy:       { type: String, default: '' },
  history:           { type: [historySchema], default: [] },
}, { timestamps: true });

// ─── Project expenses ────────────────────────────────────────────────────────
const expenseSchema = new Schema({
  projectId:   { type: String, required: true, index: true },
  date:        { type: String, required: true },        // 'YYYY-MM-DD'
  expenseType: { type: String, default: 'Other' },      // Travelling / Food / Software / Other
  planType:    { type: String, enum: ['Actual', 'Planned', 'To Be Spent'], default: 'Actual' },
  amount:      { type: Number, required: true },
  note:        { type: String, default: '' },
  createdBy:   { type: String, default: '' },
}, { timestamps: true });

// ─── Resource allocation (who approves whom) ─────────────────────────────────
const allocationSchema = new Schema({
  managerId: { type: String, required: true, unique: true },
  userIds:   { type: [String], default: [] },
}, { timestamps: true });

// ─── Holidays (compliance calendar) ──────────────────────────────────────────
const holidaySchema = new Schema({
  date: { type: String, required: true, unique: true }, // 'YYYY-MM-DD'
  name: { type: String, default: 'Holiday' },
}, { timestamps: true });

module.exports = {
  Timesheet:     mongoose.model('Timesheet', timesheetSchema),
  ResourceCost:  mongoose.model('ResourceCost', resourceCostSchema),
  PlannedCost:   mongoose.model('PlannedCost', plannedCostSchema),
  BudgetRequest: mongoose.model('BudgetRequest', budgetRequestSchema),
  Expense:       mongoose.model('Expense', expenseSchema),
  Allocation:    mongoose.model('Allocation', allocationSchema),
  Holiday:       mongoose.model('Holiday', holidaySchema),
};
