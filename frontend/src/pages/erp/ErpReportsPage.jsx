import { useEffect, useState } from 'react';
import { erpWorkDone, erpCompliance, erpBudgetVsActual, erpProjects } from '../../api';
import { useErpMe, useAsync } from './erpHooks';
import { PageHead, Tabs, Banner, Empty } from './ErpBits';
import { fmtHM, fmtH, fmtINR, fyOf, fyRange, dayLabel, todayIso, errMsg, downloadCsv, sum } from './erpUtils';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function WorkDone({ me, projects }) {
  const t = todayIso(); const [from, setFrom] = useState(t.slice(0, 8) + '01'); const [to, setTo] = useState(t);
  const [projectId, setProjectId] = useState(''); const [userId, setUserId] = useState(''); const [d, setD] = useState(null); const [msg, setMsg] = useState('');
  const run = async () => { try { const r = await erpWorkDone({ from, to, ...(projectId ? { projectId } : {}), ...(userId ? { userId } : {}) }); setD(r.data); setMsg(''); } catch (e) { setMsg(errMsg(e)); } };
  useAsync(() => run(), []);
  const byUser = {}; (d?.rows || []).forEach(r => (byUser[r.userName] ||= []).push(r));
  return (
    <>
      <div className="erp-toolbar">
        <label className="erp-field"><span>From</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="erp-field"><span>To</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="erp-field"><span>Project</span><select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All</option>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>
        <label className="erp-field"><span>Person</span><select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Everyone I can see</option><option value={me?.user.id}>Me</option>{me?.reports.map(r => <option key={r._id} value={r._id}>{r.name}</option>)}</select></label>
        <span className="spacer" /><button className="btn btn-primary btn-sm" onClick={run}>Filter</button>
        <button className="btn btn-ghost btn-sm" disabled={!d} onClick={() => downloadCsv('work-done.csv', [['Person', 'Week', 'Project', 'Sprint', 'Category', 'Status', ...Array.from({ length: 7 }, (_, i) => `Day ${i + 1}`), 'Total'], ...d.rows.map(r => [r.userName, `${r.week}/${r.year}`, r.projectName, r.sprintName, r.category, r.status, ...r.cells.map(c => fmtHM(c)), fmtHM(r.total)])])}>Export CSV</button>
      </div>
      {msg && <Banner kind="err">{msg}</Banner>}
      {d && !d.rows.length && <Empty>No hours logged in this range.</Empty>}
      {Object.entries(byUser).map(([name, rows]) => (
        <div key={name} className="erp-card">
          <div className="erp-card-head"><h3>{name}</h3><span className="erp-note">{fmtHM(sum(rows.map(r => r.total)))} in {rows.length} entries</span></div>
          <div className="erp-tablewrap"><table className="erp-table">
            <thead><tr><th>Week</th><th>Project</th><th>Sprint</th><th>Category</th><th>Status</th>{rows[0].days.map((x, i) => <th key={i} className="c">D{i + 1}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}><td>Wk {r.week}<div className="sub">{dayLabel(r.days[0])}–{dayLabel(r.days[6])}</div></td><td className="name">{r.projectName}</td><td>{r.sprintName || <span className="dim">—</span>}</td><td>{r.category || <span className="dim">—</span>}</td><td><span className={`erp-status ${r.status}`}>{r.status}</span></td>{r.cells.map((c, j) => <td key={j} className="c">{c ? fmtHM(c) : <span className="dim">·</span>}</td>)}<td className="num" style={{ fontWeight: 600 }}>{fmtHM(r.total)}</td></tr>)}</tbody>
          </table></div>
        </div>
      ))}
    </>
  );
}

function Compliance({ me }) {
  const now = new Date(); const [year, setYear] = useState(now.getFullYear()); const [month, setMonth] = useState(now.getMonth() + 1); const [scope, setScope] = useState(me?.isManager || me?.isAdmin ? 'team' : 'me'); const [d, setD] = useState(null);
  const run = () => erpCompliance({ year, month, scope }).then(r => setD(r.data)).catch(() => {});
  useAsync(() => run(), [year, month, scope]);
  return (
    <>
      <div className="erp-toolbar">
        <label className="erp-field"><span>Year</span><select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 2, year - 1, year, year + 1].map(y => <option key={y}>{y}</option>)}</select></label>
        <label className="erp-field"><span>Month</span><select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label className="erp-field"><span>Scope</span><select className="input" value={scope} onChange={(e) => setScope(e.target.value)}><option value="me">My timesheet</option>{(me?.isManager || me?.isAdmin) && <option value="team">My team</option>}</select></label>
        <span className="spacer" /><span className="erp-note">P = hours logged · M = working day with nothing logged · H = weekend / holiday</span>
      </div>
      {d && (
        <div className="erp-tablewrap"><table className="erp-table">
          <thead><tr><th className="sticky">Resource</th><th className="num">%</th><th className="num">P</th><th className="num">W</th><th className="num">M</th>{d.days.map(x => <th key={x} className="c cal-cell">{Number(x.slice(8))}</th>)}</tr></thead>
          <tbody>{d.rows.map(r => <tr key={r.userId}><td className="sticky name">{r.userName}</td><td className="num" style={{ fontWeight: 700, color: r.pct >= 90 ? 'var(--accent-green)' : r.pct >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>{r.pct}</td><td className="num">{r.present}</td><td className="num">{r.working}</td><td className="num">{r.missing}</td>{r.cells.map((c, i) => <td key={i} className={`cal-cell ${c}`}>{c}</td>)}</tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

function BudgetVsActual({ me, projects }) {
  const fy = fyOf(); const [mode, setMode] = useState('me'); const [projectId, setProjectId] = useState(''); const [unit, setUnit] = useState('hours'); const [from, setFrom] = useState(fyRange(fy).from); const [to, setTo] = useState(fyRange(fy).to); const [d, setD] = useState(null); const [msg, setMsg] = useState('');
  const run = async () => { try { const r = await erpBudgetVsActual({ from, to, unit, ...(mode === 'project' && projectId ? { projectId } : {}) }); setD(r.data); setMsg(''); } catch (e) { setMsg(errMsg(e)); } };
  useAsync(() => run(), [mode, projectId, unit]);
  const f = (v) => (unit === 'amount' ? fmtINR(v) : `${fmtH(v, 0)}h`);
  return (
    <>
      <div className="erp-toolbar">
        <label className="erp-field"><span>View</span><select className="input" value={mode} onChange={(e) => setMode(e.target.value)}><option value="me">My budget vs actual</option>{me?.canSeeMoney && <option value="project">Project-wise (per person)</option>}</select></label>
        {mode === 'project' && <label className="erp-field"><span>Project</span><select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Select…</option>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>}
        {mode === 'project' && <label className="erp-field"><span>Display</span><select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="hours">Hours</option><option value="amount">Amount (₹)</option></select></label>}
        <label className="erp-field"><span>From</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="erp-field"><span>To</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="spacer" /><button className="btn btn-primary btn-sm" onClick={run}>Filter</button>
      </div>
      {msg && <Banner kind="err">{msg}</Banner>}
      {d && !d.rows.length && <Empty>No planned hours or logged time in this range.</Empty>}
      {d && d.rows.length > 0 && (
        <div className="erp-tablewrap"><table className="erp-table">
          <thead><tr><th className="sticky">{mode === 'project' ? 'Resource' : 'Project'}</th><th /> {d.monthLabels.map(m => <th key={m} className="num">{m}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>{d.rows.map(r => (
            ['planned', 'used', 'remaining'].map((k, i) => (
              <tr key={r.key + k}>{i === 0 && <td className="sticky name" rowSpan={3}>{r.label}</td>}<td className="sub" style={{ textTransform: 'capitalize' }}>{k}</td>
                {d.months.map(m => { const c = r.cells[m]; const v = !c ? 0 : k === 'remaining' ? c.planned - c.used : c[k]; return <td key={m} className={`num ${k === 'remaining' && v < 0 ? 'heat neg' : ''}`}>{c ? f(v) : <span className="dim">·</span>}</td>; })}
                <td className={`num ${k === 'remaining' && r.totals.remaining < 0 ? 'heat neg' : ''}`} style={{ fontWeight: 600 }}>{f(r.totals[k])}</td></tr>
            ))))}</tbody>
        </table></div>
      )}
    </>
  );
}

export default function ErpReportsPage() {
  const { me } = useErpMe();
  const [tab, setTab] = useState('workdone'); const [projects, setProjects] = useState([]);
  useEffect(() => { erpProjects().then(r => setProjects(r.data)).catch(() => {}); }, []);
  return (
    <div className="erp-page">
      <PageHead title="Reports" subtitle="Work done per person, timesheet compliance per month, and planned versus used hours." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'workdone', label: 'Work done' }, { id: 'compliance', label: 'Timesheet compliance' }, { id: 'budget', label: 'Budget vs actual' }]} />
      {me && tab === 'workdone' && <WorkDone me={me} projects={projects} />}
      {me && tab === 'compliance' && <Compliance me={me} />}
      {me && tab === 'budget' && <BudgetVsActual me={me} projects={projects} />}
    </div>
  );
}
