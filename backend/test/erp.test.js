const test = require('node:test');
const assert = require('node:assert');
const { LEAVE_TITLE, weeksOf, weekFor, istIso, fyOf, monthsBetween, workingDays } = require('../routes/erp')._helpers;

test('week 1 runs from 1 Jan to the first Sunday, later weeks are Mon-Sun', () => {
  const w = weeksOf(2026); // 1 Jan 2026 is a Thursday, first Sunday is 4 Jan
  assert.deepStrictEqual([w[0].start, w[0].end], ['2026-01-01', '2026-01-04']);
  assert.deepStrictEqual([w[1].start, w[1].end], ['2026-01-05', '2026-01-11']);
  assert.strictEqual(w[w.length - 1].end, '2026-12-31');
});

test('legacy week numbers are preserved (17 Sep 2026 is week 38)', () => {
  assert.strictEqual(weekFor('2026-09-17').week, 38);
});

test('every week has seven Mon..Sun day strings', () => {
  for (const w of weeksOf(2026)) {
    assert.strictEqual(w.days.length, 7);
    assert.strictEqual(new Date(w.days[0] + 'T00:00:00Z').getUTCDay(), 1);
  }
});

test('IST date rolls over at 18:30 UTC, not midnight UTC', () => {
  assert.strictEqual(istIso('2026-09-17T18:29:00Z'), '2026-09-17');
  assert.strictEqual(istIso('2026-09-17T18:31:00Z'), '2026-09-18');
});

test('Indian financial year is Apr-Mar', () => {
  assert.strictEqual(fyOf('2026-03-31'), 2025);
  assert.strictEqual(fyOf('2026-04-01'), 2026);
});

test('leave titles are recognised but design/docs tasks are not', () => {
  for (const ok of ['Casual Leave', 'Sick Leave', 'Public Holiday', 'Leave', 'Half day off']) assert.ok(LEAVE_TITLE.test(ok), ok);
  for (const no of ['Mayvel holiday post', 'Mayvel - Public Holiday Calendar Design', 'Seyo: Roles and Permission Documentation', 'Diwali Poster']) assert.ok(!LEAVE_TITLE.test(no), no);
});

test('monthsBetween is inclusive', () => {
  assert.deepStrictEqual(monthsBetween('2026-11-15', '2027-01-02'), ['2026-11', '2026-12', '2027-01']);
});

test('working days skip weekends and holidays', () => {
  assert.strictEqual(workingDays('2026-11', new Set()), 21);
  assert.strictEqual(workingDays('2026-11', new Set(['2026-11-09'])), 20);
});
