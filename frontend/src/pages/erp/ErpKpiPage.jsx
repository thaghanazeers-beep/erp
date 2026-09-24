import { useMemo, useState } from 'react';
import Avatar from '../../components/Avatar';
import { erpKpi } from '../../api';
import { useErpMe, useAsync } from './erpHooks';
import { PageHead, Banner, Empty } from './ErpBits';
import { fmtHM, fmtH, fyOf, fyRange, todayIso, pad, errMsg, downloadCsv } from './erpUtils';
import './ErpKpiPage.css';

const PRESETS = [
  { id: 'month', label: 'This month', range: () => { const t = todayIso(); return [t.slice(0, 8) + '01', t]; } },
  { id: '30d', label: 'Last 30 days', range: () => { const d = new Date(); d.setDate(d.getDate() - 29); return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, todayIso()]; } },
  { id: 'quarter', label: 'This quarter', range: () => { const t = todayIso(); const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7)); const qStart = m - ((m - 1) % 3); return [`${y}-${pad(qStart)}-01`, t]; } },
  { id: 'fy', label: 'This financial year', range: () => { const r = fyRange(fyOf()); return [r.from, todayIso()]; } },
  { id: 'custom', label: 'Custom', range: null },
];

// KPI definitions: label, what it measures, and how to read the person's raw numbers.
const KPIS = [
  { key: 'delivery', short: 'On-time', label: 'On-time delivery', weight: 25, why: 'Completed tasks finished on or before their due date.', detail: (r) => (r.tasks.withDue ? `${r.tasks.onTime} of ${r.tasks.withDue} stamped tasks on time` : 'No completed tasks with a completion stamp yet') + (r.tasks.tracked < r.tasks.completed ? ` · ${r.tasks.completed - r.tasks.tracked} completed before tracking started` : '') },
  { key: 'compliance', short: 'Compliance', label: 'Timesheet compliance', weight: 20, why: 'Working days with hours logged.', detail: (r) => `${r.time.presentDays} of ${r.time.workingDays} working days` },
  { key: 'submission', short: 'Submitted', label: 'Submitted on time', weight: 15, why: 'Weeks submitted within 3 days of the week ending.', detail: (r) => `${r.time.promptWeeks} of ${r.time.dueWeeks} weeks · ${r.time.submittedWeeks} submitted at all` },
  { key: 'utilisation', short: 'Capacity', label: 'Capacity used', weight: 15, why: 'Hours logged against 8 h per working day.', detail: (r) => `${fmtHM(r.time.loggedMinutes)} of ${fmtHM(r.time.capacityMinutes)} · ${r.time.billablePct ?? 0}% billable` },
  { key: 'accuracy', short: 'Estimates', label: 'Estimate accuracy', weight: 15, why: 'How close actual hours came to the estimate on completed tasks.', detail: (r) => (r.tasks.ratio == null ? 'No completed tasks with both estimate and actual hours' : `${fmtH(r.tasks.actualHours, 0)} h actual vs ${fmtH(r.tasks.estimatedHours, 0)} h estimated (×${r.tasks.ratio.toFixed(2)})`) },
  { key: 'quality', short: 'Quality', label: 'First-time quality', weight: 10, why: 'Share of finished tasks that were completed rather than rejected.', detail: (r) => `${r.tasks.completed} completed · ${r.tasks.rejected} rejected` },
];

const tone = (v) => (v == null ? 'none' : v >= 85 ? 'good' : v >= 60 ? 'warn' : 'bad');
const gradeTone = (g) => ({ A: 'good', B: 'ok', C: 'warn', D: 'bad' }[g] || 'none');

/** Eight-week hours sparkline: one series, one hue, direct max label, per-bar hover. */
function Spark({ weekly, height = 26 }) {
  const max = Math.max(1, ...weekly.map(w => w.minutes));
  const bw = 8, gap = 3, w = weekly.length * (bw + gap);
  return (
    <svg className="kpi-spark" width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`Hours per week, last ${weekly.length} weeks`}>
      {weekly.map((x, i) => { const h = x.minutes ? Math.max(2, Math.round((x.minutes / max) * (height - 2))) : 1; return (
        <g key={i}><title>{`Week ${x.week} (${x.range}): ${fmtHM(x.minutes)}`}</title>
          <rect x={i * (bw + gap)} y={height - h} width={bw} height={h} rx={x.minutes ? 2 : 0} className={x.minutes ? 'on' : 'off'} /></g>); })}
    </svg>
  );
}

function Meter({ value }) {
  return <div className={`kpi-meter ${tone(value)}`}><i style={{ width: `${value ?? 0}%` }} /></div>;
}

function PersonDetail({ r, team, onClose }) {
  return (
    <div className="erp-card kpi-detail">
      <div className="erp-card-head">
        <div className="kpi-who"><Avatar name={r.name} src={r.avatar || undefined} members={team} size={40} /><div><h3>{r.name}</h3><span className="erp-note">Score {r.score ?? '—'} · grade {r.grade}</span></div></div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>
      <div className="kpi-tiles">
        {KPIS.map(k => { const v = r.components[k.key]; return (
          <div key={k.key} className={`kpi-tile ${tone(v)}`}>
            <div className="kpi-tile-top"><span>{k.label}</span><b>{v == null ? '—' : `${v}%`}</b></div>
            <Meter value={v} />
            <small>{k.detail(r)}</small>
            <small className="dim">{k.why} Weight {k.weight}%.</small>
          </div>); })}
      </div>
      <div className="kpi-facts">
        <div><b>{r.tasks.completed}</b><span>Completed</span></div>
        <div><b>{r.tasks.open}</b><span>Open</span></div>
        <div className={r.tasks.overdue ? 'bad' : ''}><b>{r.tasks.overdue}</b><span>Overdue</span></div>
        <div><b>{r.tasks.inReview}</b><span>In review</span></div>
        <div><b>{fmtHM(r.time.loggedMinutes)}</b><span>Hours logged</span></div>
        <div><b>{fmtHM(r.time.approvedMinutes)}</b><span>Approved hours</span></div>
        <div><b>{r.time.planUsedPct == null ? '—' : `${r.time.planUsedPct}%`}</b><span>Of planned {r.time.plannedHours ? `${fmtH(r.time.plannedHours, 0)} h` : ''}</span></div>
        <div><b>{r.time.approvedSheets}/{r.time.approvedSheets + r.time.rejectedSheets}</b><span>Sheets approved</span></div>
      </div>
      <div className="kpi-weekly"><span className="erp-note">Hours per week, last 8 weeks</span><Spark weekly={r.weekly} height={48} /><div className="kpi-weekly-labels">{r.weekly.map(w => <span key={w.week}>Wk {w.week}<br />{fmtH(w.minutes / 60, 0)}h</span>)}</div></div>
    </div>
  );
}

export default function ErpKpiPage() {
  const { me } = useErpMe();
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState({ from: todayIso().slice(0, 8) + '01', to: todayIso() });
  const [scope, setScope] = useState('team');
  const [d, setD] = useState(null); const [msg, setMsg] = useState(''); const [sel, setSel] = useState(null); const [q, setQ] = useState('');
  const range = useMemo(() => { const p = PRESETS.find(x => x.id === preset); return p.range ? p.range() : [custom.from, custom.to]; }, [preset, custom]);
  const load = async () => { try { const r = await erpKpi({ from: range[0], to: range[1], scope }); setD(r.data); setMsg(''); } catch (e) { setMsg(errMsg(e)); } };
  useAsync(() => load(), [range[0], range[1], scope]);
  const rows = (d?.rows || []).filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  const selected = rows.find(r => r.userId === sel) || null;
  const canSeeOthers = me?.isManager || me?.isAdmin;

  return (
    <div className="erp-page">
      <PageHead title="KPI dashboard" subtitle="How each person is delivering: on-time tasks, timesheet discipline, capacity used, estimate accuracy and first-time quality, rolled into one score.">
        <button className="btn btn-ghost btn-sm" disabled={!d} onClick={() => downloadCsv(`kpi-${range[0]}-${range[1]}.csv`, [['Person', 'Score', 'Grade', ...KPIS.map(k => k.label), 'Completed', 'Open', 'Overdue', 'Hours logged', 'Billable %'], ...rows.map(r => [r.name, r.score ?? '', r.grade, ...KPIS.map(k => r.components[k.key] ?? ''), r.tasks.completed, r.tasks.open, r.tasks.overdue, fmtHM(r.time.loggedMinutes), r.time.billablePct ?? ''])])}>Export CSV</button>
      </PageHead>

      <div className="erp-toolbar">
        <div className="erp-field"><span>Period</span><div className="erp-chips">{PRESETS.map(p => <button key={p.id} className={`erp-chip ${preset === p.id ? 'on' : ''}`} onClick={() => setPreset(p.id)}>{p.label}</button>)}</div></div>
        {preset === 'custom' && <><label className="erp-field"><span>From</span><input type="date" className="input" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label><label className="erp-field"><span>To</span><input type="date" className="input" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label></>}
        {canSeeOthers && <label className="erp-field"><span>People</span><select className="input" value={scope} onChange={(e) => setScope(e.target.value)}><option value="me">Just me</option><option value="team">Me and my team</option>{me?.isAdmin && <option value="all">Everyone</option>}</select></label>}
        <label className="erp-field grow"><span>Find</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" /></label>
        <span className="erp-note">{d ? `${d.from} → ${d.to} · ${d.workingDays} working days` : ''}</span>
      </div>
      {msg && <Banner kind="err">{msg}</Banner>}

      {d && (
        <div className="erp-kpis">
          <div className={`erp-kpi ${tone(d.team.avgScore)}`}><b>{d.team.avgScore ?? '—'}</b><span>Average score · {d.team.people} people</span></div>
          <div className={`erp-kpi ${tone(d.team.onTime)}`}><b>{d.team.onTime == null ? '—' : `${d.team.onTime}%`}</b><span>On-time delivery</span></div>
          <div className="erp-kpi"><b>{d.team.completed}</b><span>Tasks completed</span></div>
          <div className={`erp-kpi ${d.team.overdue ? 'bad' : 'good'}`}><b>{d.team.overdue}</b><span>Overdue now</span></div>
          <div className="erp-kpi"><b>{fmtHM(d.team.loggedMinutes)}</b><span>Hours logged · {d.team.billablePct ?? 0}% billable</span></div>
          <div className={`erp-kpi ${tone(d.team.compliance)}`}><b>{d.team.compliance == null ? '—' : `${d.team.compliance}%`}</b><span>Timesheet compliance</span></div>
        </div>
      )}

      {selected && <PersonDetail r={selected} team={[]} onClose={() => setSel(null)} />}

      {d && !rows.length && <Empty>No people in this scope.</Empty>}
      {d && rows.length > 0 && (
        <div className="erp-tablewrap">
          <table className="erp-table kpi-table">
            <thead><tr><th className="c">#</th><th>Person</th><th className="c">Score</th>{KPIS.map(k => <th key={k.key} className="num" title={`${k.label}: ${k.why} Weight ${k.weight}%`}>{k.short}</th>)}<th className="num">Done</th><th className="num">Overdue</th><th className="num">Hours</th><th>Last 8 weeks</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.userId} className={`clickable ${sel === r.userId ? 'is-selected' : ''}`} onClick={() => setSel(sel === r.userId ? null : r.userId)}>
                  <td className="c dim">{i + 1}</td>
                  <td className="name"><span className="kpi-who"><Avatar name={r.name} src={r.avatar || undefined} size={24} />{r.name}</span></td>
                  <td className="c"><span className={`kpi-grade ${gradeTone(r.grade)}`}>{r.score ?? '—'}<small>{r.grade}</small></span></td>
                  {KPIS.map(k => { const v = r.components[k.key]; return <td key={k.key} className="num"><span className={`kpi-val ${tone(v)}`}>{v == null ? <span className="dim">—</span> : `${v}%`}</span></td>; })}
                  <td className="num">{r.tasks.completed}</td>
                  <td className={`num ${r.tasks.overdue ? 'kpi-bad-text' : ''}`}>{r.tasks.overdue}</td>
                  <td className="num">{fmtHM(r.time.loggedMinutes)}</td>
                  <td><Spark weekly={r.weekly} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="erp-note">Score = weighted average of the six KPIs (weights in the column tooltips); a KPI with no data in the period is left out of the weighting. Grades: A ≥ 85, B ≥ 70, C ≥ 50. On-time delivery counts only tasks completed since completion stamps were introduced; older completed tasks are shown in the totals but not judged.</p>
    </div>
  );
}
