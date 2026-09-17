import { useEffect, useMemo, useState } from 'react';
import { erpProjects, erpCreateProject, erpUpdateProject, erpPlSummary, erpPlProject, erpPlanned, erpSavePlanned, erpBudgetRequests, erpCreateBudgetRequest, erpDecideBudget, erpDeleteBudget, erpExpenses, erpCreateExpense, erpDeleteExpense, getTeam } from '../../api';
import { useErpMe, useAsync } from './erpHooks';
import { PageHead, Tabs, Banner, Empty, Modal, StatusChip } from './ErpBits';
import { fmtINR, fmtH, fmtPct, fyOf, fyRange, fmtDate, todayIso, errMsg, downloadCsv, erpTakeJump } from './erpUtils';

const TYPES = ['Product', 'Service', 'Others'];
const STATUSES = ['Active', 'In Progress', 'InActive', 'Completed'];
const REASONS = ['Billable Estimate', 'Non-Billable Estimate', 'Non-productive', 'Change request', 'Extension'];
const EXPENSE_TYPES = ['Travelling', 'Food Expenses', 'Software / Licences', 'Hardware', 'Other'];
const PLAN_TYPES = ['Actual', 'Planned', 'To Be Spent'];

const Heat = ({ v, pct }) => <td className={`heat ${v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero'}`}>{pct ? fmtPct(v) : fmtINR(v)}</td>;

// ─── Summary (portfolio) ────────────────────────────────────────────────────
function Summary({ onOpen }) {
  const fy = fyOf(); const [from, setFrom] = useState(fyRange(fy).from); const [to, setTo] = useState(fyRange(fy).to);
  const [types, setTypes] = useState(TYPES); const [statuses, setStatuses] = useState(['Active', 'In Progress']);
  const [rows, setRows] = useState(null); const [msg, setMsg] = useState('');
  const run = async () => { try { const r = await erpPlSummary({ from, to, types: types.join(','), statuses: statuses.join(',') }); setRows(r.data.rows); setMsg(''); } catch (e) { setMsg(errMsg(e)); } };
  useAsync(() => run(), []);
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const tot = (k) => (rows || []).reduce((a, r) => a + r[k], 0);
  return (
    <>
      <div className="erp-toolbar">
        <label className="erp-field"><span>From</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="erp-field"><span>To</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="erp-field"><span>Type</span><div className="erp-chips">{TYPES.map(t => <button key={t} className={`erp-chip ${types.includes(t) ? 'on' : ''}`} onClick={() => toggle(types, setTypes, t)}>{t}</button>)}</div></div>
        <div className="erp-field"><span>Status</span><div className="erp-chips">{STATUSES.map(t => <button key={t} className={`erp-chip ${statuses.includes(t) ? 'on' : ''}`} onClick={() => toggle(statuses, setStatuses, t)}>{t}</button>)}</div></div>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={run}>Filter</button>
        <button className="btn btn-ghost btn-sm" disabled={!rows} onClick={() => downloadCsv('profit-loss-summary.csv', [['Project', 'Type', 'Status', 'Budget', 'Actual spent', 'To be spent', 'Projected', 'P&L', 'P&L %', 'Hours'], ...rows.map(r => [r.name, r.type, r.status, r.budget, Math.round(r.actualSpent), Math.round(r.toBeSpent), Math.round(r.projected), Math.round(r.pl), r.plPct.toFixed(2), r.hours.toFixed(1)])])}>Export CSV</button>
      </div>
      {msg && <Banner kind="err">{msg}</Banner>}
      {rows && (
        <>
          <div className="erp-kpis">
            <div className="erp-kpi"><b>{fmtINR(tot('budget'))}</b><span>Budget</span></div>
            <div className="erp-kpi"><b>{fmtINR(tot('actualSpent'))}</b><span>Actual spent</span></div>
            <div className="erp-kpi"><b>{fmtINR(tot('toBeSpent'))}</b><span>To be spent</span></div>
            <div className={`erp-kpi ${tot('pl') >= 0 ? 'good' : 'bad'}`}><b>{fmtINR(tot('pl'))}</b><span>Profit &amp; loss</span></div>
            <div className={`erp-kpi ${tot('pl') >= 0 ? 'good' : 'bad'}`}><b>{fmtPct(tot('budget') ? (tot('pl') / tot('budget')) * 100 : 0)}</b><span>Margin</span></div>
          </div>
          <div className="erp-tablewrap">
            <table className="erp-table">
              <thead><tr><th>Project</th><th>Type</th><th>Status</th><th className="num">Budget</th><th className="num">Actual spent</th><th className="num">To be spent</th><th className="num">Projected</th><th className="num">P&amp;L</th><th className="num">P&amp;L %</th><th className="num">Hours</th></tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={10}><Empty>No projects match these filters.</Empty></td></tr>}
                {rows.map(r => <tr key={r.projectId} className="clickable" onClick={() => onOpen(r.projectId)}><td className="name">{r.name}</td><td>{r.type}</td><td><span className="erp-status draft">{r.status}</span></td><td className="num">{fmtINR(r.budget)}</td><td className="num">{fmtINR(r.actualSpent)}</td><td className="num">{fmtINR(r.toBeSpent)}</td><td className="num">{fmtINR(r.projected)}</td><Heat v={r.pl} /><Heat v={r.plPct} pct /><td className="num">{fmtH(r.hours)}</td></tr>)}
              </tbody>
              {rows.length > 0 && <tfoot><tr><td colSpan={3}>Total</td><td className="num">{fmtINR(tot('budget'))}</td><td className="num">{fmtINR(tot('actualSpent'))}</td><td className="num">{fmtINR(tot('toBeSpent'))}</td><td className="num">{fmtINR(tot('projected'))}</td><Heat v={tot('pl')} /><Heat v={tot('budget') ? (tot('pl') / tot('budget')) * 100 : 0} pct /><td className="num">{fmtH(tot('hours'))}</td></tr></tfoot>}
            </table>
          </div>
        </>
      )}
    </>
  );
}

// ─── Projects setup ─────────────────────────────────────────────────────────
function ProjectForm({ initial, team, onSave, onClose, canCreate }) {
  const [f, setF] = useState({ name: '', client: '', description: '', type: 'Service', status: 'Active', startDate: fyRange(fyOf()).from, endDate: fyRange(fyOf()).to, managerId: '', memberIds: [], budget: 0, billable: true, ...initial, categories: initial?.categories || [] });
  const [cats, setCats] = useState((initial?.categories || []).join(', '));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const toggleMember = (id) => set('memberIds', f.memberIds.includes(id) ? f.memberIds.filter(x => x !== id) : [...f.memberIds, id]);
  return (
    <Modal title={initial?._id ? `Project setup — ${initial.name}` : 'New project'} onClose={onClose} width={760}>
      <div className="erp-form">
        <label className="full">Project name<input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label>Client / owner<input className="input" value={f.client} onChange={(e) => set('client', e.target.value)} placeholder="e.g. Shlok" /></label>
        <label>Project manager<select className="input" value={f.managerId} onChange={(e) => set('managerId', e.target.value)}><option value="">—</option>{team.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}</select></label>
        <label>Type<select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Status<select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Start date<input type="date" className="input" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></label>
        <label>End date<input type="date" className="input" value={f.endDate || ''} onChange={(e) => set('endDate', e.target.value)} /></label>
        <label>Manual budget (₹) <span className="erp-note">used only while no budget request is approved</span><input type="number" className="input" value={f.budget} onChange={(e) => set('budget', Number(e.target.value))} /></label>
        <label>Billable<select className="input" value={f.billable ? 'yes' : 'no'} onChange={(e) => set('billable', e.target.value === 'yes')}><option value="yes">Billable</option><option value="no">Non-billable (bench, leave, holidays…)</option></select></label>
        <label className="full">Description<textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="full">Booking categories (comma separated; leave empty for the default seven)<input className="input" value={cats} onChange={(e) => setCats(e.target.value)} placeholder="Development, Analysis, Testing/QA, …" /></label>
        <div className="full"><label>Internal team members ({f.memberIds.length} selected) — <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('memberIds', f.memberIds.length === team.length ? [] : team.map(u => u._id))}>{f.memberIds.length === team.length ? 'Clear all' : 'Select all'}</button></label>
          <div className="erp-checklist">{team.map(u => <label key={u._id}><input type="checkbox" checked={f.memberIds.includes(u._id)} onChange={() => toggleMember(u._id)} />{u.name}</label>)}</div>
        </div>
      </div>
      <div className="erp-modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.name || (!initial?._id && !canCreate)} onClick={() => onSave({ ...f, categories: cats.split(',').map(s => s.trim()).filter(Boolean) })}>Save</button></div>
    </Modal>
  );
}

function Projects({ me, projects, team, reload, onOpen }) {
  const [edit, setEdit] = useState(null); const [q, setQ] = useState(''); const [msg, setMsg] = useState(null);
  const canCreate = me?.isAdmin || me?.user.role === 'Team Owner';
  const save = async (f) => { try { if (f._id) await erpUpdateProject(f._id, f); else await erpCreateProject(f); setEdit(null); await reload(); setMsg({ kind: 'ok', text: 'Project saved.' }); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } };
  const list = projects.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.client || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="erp-toolbar">
        <label className="erp-field grow"><span>Search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Project or client" /></label>
        {canCreate && <button className="btn btn-primary btn-sm" onClick={() => setEdit({})}>+ New project</button>}
      </div>
      {msg && <Banner kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Banner>}
      <div className="erp-tablewrap">
        <table className="erp-table">
          <thead><tr><th>Project</th><th>Client</th><th>Type</th><th>Status</th><th>Manager</th><th>Start</th><th>End</th><th className="num">Members</th><th className="num">Budget</th><th /></tr></thead>
          <tbody>
            {list.map(p => <tr key={p._id}><td className="name clickable" onClick={() => onOpen(p._id)}>{p.icon} {p.name}</td><td>{p.client || <span className="dim">—</span>}</td><td>{p.type || 'Others'}</td><td><span className="erp-status draft">{p.status || 'Active'}</span></td><td>{p.managerName || <span className="dim">—</span>}</td><td>{fmtDate(p.startDate)}</td><td>{fmtDate(p.endDate)}</td><td className="num">{p.memberIds?.length || 0}</td><td className="num">{fmtINR(p.budgetApproved || p.budget || 0)}</td><td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-sm" onClick={() => setEdit(p)}>Setup</button></td></tr>)}
          </tbody>
        </table>
      </div>
      {edit && <ProjectForm initial={edit} team={team} canCreate={canCreate} onClose={() => setEdit(null)} onSave={save} />}
    </>
  );
}

// ─── Planned cost grid ──────────────────────────────────────────────────────
function Planned({ projectId, project }) {
  const [g, setG] = useState(null); const [cells, setCells] = useState({}); const [dirty, setDirty] = useState(false); const [msg, setMsg] = useState(null);
  const load = async () => { try { const r = await erpPlanned(projectId); setG(r.data); const c = {}; r.data.rows.forEach(row => Object.entries(row.cells).forEach(([m, v]) => { c[`${row.userId}|${m}`] = { billableHours: v.billableHours, nonBillableHours: v.nonBillableHours }; })); setCells(c); setDirty(false); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } };
  useAsync(() => load(), [projectId]);
  const save = async () => { try { await erpSavePlanned(projectId, Object.entries(cells).map(([k, v]) => { const [userId, month] = k.split('|'); return { userId, month, ...v }; })); setMsg({ kind: 'ok', text: 'Plan saved.' }); await load(); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } };
  const fillWorkingDays = (userId) => { setCells(c => { const n = { ...c }; g.months.forEach(m => { n[`${userId}|${m}`] = { billableHours: g.workingDays[m] * 8, nonBillableHours: 0 }; }); return n; }); setDirty(true); };
  if (!g) return msg ? <Banner kind="err">{msg.text}</Banner> : null;
  const hrs = (uid, m) => (cells[`${uid}|${m}`]?.billableHours || 0) + (cells[`${uid}|${m}`]?.nonBillableHours || 0);
  const rowTotals = (row) => g.months.reduce((a, m) => { const h = hrs(row.userId, m); return { hours: a.hours + h, cost: a.cost + h * row.rates[m], actual: a.actual + row.cells[m].actualCost }; }, { hours: 0, cost: 0, actual: 0 });
  const grand = g.rows.reduce((a, r) => { const t = rowTotals(r); return { hours: a.hours + t.hours, cost: a.cost + t.cost, actual: a.actual + t.actual }; }, { hours: 0, cost: 0, actual: 0 });
  return (
    <>
      <div className="erp-toolbar"><span className="erp-note">{project?.name} · {fmtDate(g.from)} – {fmtDate(g.to)} · hours per person per month (billable / non-billable). Cost = hours × hourly rate (daily cost ÷ 8) from the rate card.</span><span className="spacer" /><button className="btn btn-primary btn-sm" disabled={!dirty} onClick={save}>Save plan</button></div>
      {msg && <Banner kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Banner>}
      {!g.rows.length && <Empty>Add team members to the project (Projects › Setup) to plan their hours.</Empty>}
      {g.rows.length > 0 && (
        <div className="erp-tablewrap">
          <table className="erp-table">
            <thead><tr><th className="sticky">Resource</th><th /> {g.months.map((m, i) => <th key={m} className="c">{g.monthLabels[i]}<br /><span className="sub">{g.workingDays[m]} days</span></th>)}<th className="num">Hours</th><th className="num">Planned cost</th><th className="num">Actual cost</th></tr></thead>
            <tbody>
              {g.rows.map(row => { const t = rowTotals(row); return (
                <tr key={row.userId}>
                  <td className="sticky name">{row.name}<div className="sub">{row.type || 'no rate card'} · <button className="btn btn-ghost btn-sm" style={{ padding: '0 6px' }} onClick={() => fillWorkingDays(row.userId)} title="Fill every month with working days × 8h billable">fill</button></div></td>
                  <td className="sub">Billable<br />Non-bill.<br />Actual</td>
                  {g.months.map(m => { const c = cells[`${row.userId}|${m}`] || { billableHours: 0, nonBillableHours: 0 }; const a = row.cells[m]; return (
                    <td key={m} className="c">
                      <input className="input cell" style={{ width: 64 }} type="number" min="0" value={c.billableHours || ''} placeholder="0" onChange={(e) => { setCells(x => ({ ...x, [`${row.userId}|${m}`]: { ...c, billableHours: Number(e.target.value) } })); setDirty(true); }} />
                      <input className="input cell" style={{ width: 64, marginTop: 3 }} type="number" min="0" value={c.nonBillableHours || ''} placeholder="0" onChange={(e) => { setCells(x => ({ ...x, [`${row.userId}|${m}`]: { ...c, nonBillableHours: Number(e.target.value) } })); setDirty(true); }} />
                      <div className="sub" title={fmtINR(a.actualCost)}>{a.actualHours ? `${fmtH(a.actualHours, 0)}h · ${fmtINR(a.actualCost)}` : '·'}</div>
                    </td>); })}
                  <td className="num">{fmtH(t.hours, 0)}</td><td className="num">{fmtINR(t.cost)}</td><td className="num">{fmtINR(t.actual)}</td>
                </tr>); })}
            </tbody>
            <tfoot><tr><td className="sticky" colSpan={2}>Total</td>{g.months.map(m => <td key={m} className="c">{fmtH(g.rows.reduce((a, r) => a + hrs(r.userId, m), 0), 0)}h</td>)}<td className="num">{fmtH(grand.hours, 0)}</td><td className="num">{fmtINR(grand.cost)}</td><td className="num">{fmtINR(grand.actual)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}

// ─── Project P&L (actual + consolidated) ────────────────────────────────────
function ProjectPl({ projectId }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [d, setD] = useState(null); const [msg, setMsg] = useState('');
  const load = async (f = from, t = to) => { try { const r = await erpPlProject(projectId, { ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) }); setD(r.data); setFrom(r.data.from); setTo(r.data.to); setMsg(''); } catch (e) { setMsg(errMsg(e)); } };
  useAsync(() => load('', ''), [projectId]);
  if (msg) return <Banner kind="err">{msg}</Banner>;
  if (!d) return null;
  const G = [['planned', 'Planned'], ['actual', 'Actual'], ['toBeSpent', 'To be spent']];
  return (
    <>
      <div className="erp-toolbar">
        <label className="erp-field"><span>From</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="erp-field"><span>To</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn btn-primary btn-sm" onClick={() => load()}>Filter</button><span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`${d.project.name}-pl.csv`, [['Resource', 'Type', 'Planned h', 'Planned ₹', 'Actual h', 'Actual ₹', 'To be spent h', 'To be spent ₹', 'Projected ₹'], ...d.users.map(u => [u.name, u.type, u.totals.planned.hours.toFixed(1), Math.round(u.totals.planned.cost), u.totals.actual.hours.toFixed(1), Math.round(u.totals.actual.cost), u.totals.toBeSpent.hours.toFixed(1), Math.round(u.totals.toBeSpent.cost), Math.round(u.totals.actual.cost + u.totals.toBeSpent.cost)])])}>Export CSV</button>
      </div>
      <div className="erp-kpis">
        <div className="erp-kpi"><b>{fmtINR(d.budget)}</b><span>Budget (approved)</span></div>
        <div className="erp-kpi"><b>{fmtINR(d.actualSpent)}</b><span>Actual spent</span></div>
        <div className="erp-kpi"><b>{fmtINR(d.toBeSpentTotal)}</b><span>To be spent</span></div>
        <div className="erp-kpi"><b>{fmtINR(d.projected)}</b><span>Projected cost</span></div>
        <div className={`erp-kpi ${d.pl >= 0 ? 'good' : 'bad'}`}><b>{fmtINR(d.pl)}</b><span>Profit &amp; loss · {fmtPct(d.plPct)}</span></div>
        <div className="erp-kpi"><b>{fmtH(d.totals.actual.hours, 0)} h</b><span>{d.users.length} resources logged</span></div>
      </div>
      <div className="erp-tablewrap">
        <table className="erp-table">
          <thead>
            <tr className="group"><th className="sticky" rowSpan={2}>Resource</th><th rowSpan={2}>Type</th>{G.map(([k, l]) => <th key={k} colSpan={2}>{l}</th>)}<th colSpan={2}>Projected</th></tr>
            <tr>{G.map(([k]) => [<th key={k + 'h'} className="num">Hours</th>, <th key={k + 'c'} className="num">Cost</th>])}<th className="num">Hours</th><th className="num">Cost</th></tr>
          </thead>
          <tbody>
            {!d.users.length && <tr><td colSpan={10}><Empty>No planned hours or logged time for this project in the range.</Empty></td></tr>}
            {d.users.map(u => <tr key={u.userId}><td className="sticky name">{u.name}</td><td className="dim">{u.type}</td>{G.map(([k]) => [<td key={k + 'h'} className="num">{fmtH(u.totals[k].hours)}</td>, <td key={k + 'c'} className="num">{fmtINR(u.totals[k].cost)}</td>])}<td className="num">{fmtH(u.totals.actual.hours + u.totals.toBeSpent.hours)}</td><td className="num">{fmtINR(u.totals.actual.cost + u.totals.toBeSpent.cost)}</td></tr>)}
            <tr className="total"><td className="sticky">Expenses</td><td /><td /><td className="num">{fmtINR(d.expenses.Planned)}</td><td /><td className="num">{fmtINR(d.expenses.Actual)}</td><td /><td className="num">{fmtINR(d.expenses['To Be Spent'])}</td><td /><td className="num">{fmtINR(d.expenses.Actual + d.expenses['To Be Spent'])}</td></tr>
          </tbody>
          <tfoot><tr><td className="sticky">Grand total</td><td />{G.map(([k]) => [<td key={k + 'h'} className="num">{fmtH(d.totals[k].hours)}</td>, <td key={k + 'c'} className="num">{fmtINR(d.totals[k].cost + (d.expenses[k === 'planned' ? 'Planned' : k === 'actual' ? 'Actual' : 'To Be Spent']))}</td>])}<td className="num">{fmtH(d.totals.actual.hours + d.totals.toBeSpent.hours)}</td><td className="num">{fmtINR(d.projected)}</td></tr></tfoot>
        </table>
      </div>
      <div className="erp-card"><h3>Monthly actual (hours)</h3>
        <div className="erp-tablewrap"><table className="erp-table"><thead><tr><th className="sticky">Resource</th>{d.monthLabels.map(m => <th key={m} className="num">{m}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>{d.users.map(u => <tr key={u.userId}><td className="sticky name">{u.name}</td>{d.months.map(m => <td key={m} className="num">{u.actual[m]?.hours ? fmtH(u.actual[m].hours, 0) : <span className="dim">·</span>}</td>)}<td className="num">{fmtH(u.totals.actual.hours, 0)}</td></tr>)}</tbody>
          <tfoot><tr><td className="sticky">Monthly total</td>{d.months.map(m => <td key={m} className="num">{fmtH(d.users.reduce((a, u) => a + (u.actual[m]?.hours || 0), 0), 0)}</td>)}<td className="num">{fmtH(d.totals.actual.hours, 0)}</td></tr></tfoot></table></div>
      </div>
    </>
  );
}

// ─── Budget requests (master plan) ──────────────────────────────────────────
function Budget({ me, projectId, project }) {
  const [rows, setRows] = useState([]); const [show, setShow] = useState(false); const [msg, setMsg] = useState(null);
  const [f, setF] = useState({ requestDate: todayIso(), cost: '', startDate: '', endDate: '', reason: REASONS[0], remarks: '' });
  const load = () => erpBudgetRequests(projectId).then(r => setRows(r.data)).catch(() => {});
  useAsync(() => load(), [projectId]);
  const approved = rows.filter(r => r.projectApproval === 'Approved' && r.financialApproval === 'Approved').reduce((a, r) => a + r.cost, 0);
  const decide = async (id, stage, decision) => { const note = decision === 'Rejected' ? (window.prompt('Reason?') ?? null) : ''; if (note === null) return; try { await erpDecideBudget(id, { stage, decision, note }); await load(); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } };
  return (
    <>
      <div className="erp-kpis">
        <div className="erp-kpi"><b>{fmtINR(approved)}</b><span>Approved budget</span></div>
        <div className="erp-kpi warn"><b>{fmtINR(rows.filter(r => r.projectApproval === 'Pending' || r.financialApproval === 'Pending').filter(r => r.projectApproval !== 'Rejected' && r.financialApproval !== 'Rejected').reduce((a, r) => a + r.cost, 0))}</b><span>Awaiting approval</span></div>
        <div className="erp-kpi"><b>{project?.managerName || '—'}</b><span>Project manager</span></div>
        <div className="erp-kpi"><b>{rows.length}</b><span>Requests</span></div>
      </div>
      <div className="ts-actions"><span className="erp-note" style={{ marginRight: 'auto' }}>Level 1 is the project approval (line manager); level 2 is the financial approval (admin). An admin approving level 1 clears both.</span><button className="btn btn-primary btn-sm" onClick={() => setShow(true)}>+ Budget request</button></div>
      {msg && <Banner kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Banner>}
      <div className="erp-tablewrap">
        <table className="erp-table">
          <thead><tr><th>Requested</th><th className="num">Cost</th><th>Period</th><th>Reason</th><th>Remarks</th><th>By</th><th>Project approval</th><th>Financial approval</th><th /></tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={9}><Empty>No budget requests yet.</Empty></td></tr>}
            {rows.map(r => (
              <tr key={r._id}>
                <td>{fmtDate(r.requestDate)}</td><td className="num" style={{ fontWeight: 600 }}>{fmtINR(r.cost)}</td><td>{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</td><td>{r.reason}</td><td className="dim">{r.remarks}</td><td>{r.requestedBy}</td>
                <td><StatusChip status={r.projectApproval} />{me?.canSeeMoney && r.projectApproval === 'Pending' && <div style={{ display: 'flex', gap: 4, marginTop: 4 }}><button className="btn btn-approve btn-sm" onClick={() => decide(r._id, 'project', 'Approved')}>Approve</button><button className="btn btn-reject btn-sm" onClick={() => decide(r._id, 'project', 'Rejected')}>Reject</button></div>}</td>
                <td><StatusChip status={r.financialApproval} />{me?.isAdmin && r.financialApproval === 'Pending' && r.projectApproval === 'Approved' && <div style={{ display: 'flex', gap: 4, marginTop: 4 }}><button className="btn btn-approve btn-sm" onClick={() => decide(r._id, 'financial', 'Approved')}>Approve</button><button className="btn btn-reject btn-sm" onClick={() => decide(r._id, 'financial', 'Rejected')}>Reject</button></div>}</td>
                <td>{me?.isAdmin && <button className="btn btn-icon" title="Delete" onClick={async () => { if (window.confirm('Delete this request?')) { await erpDeleteBudget(r._id); load(); } }}>×</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some(r => r.history?.length) && <div className="erp-card"><h3>Workflow history</h3><ul className="erp-hist">{rows.flatMap(r => r.history.map(h => ({ ...h, cost: r.cost }))).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30).map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · <b>{h.by}</b> {h.action} · {fmtINR(h.cost)}{h.note ? ` — ${h.note}` : ''}</li>)}</ul></div>}
      {show && (
        <Modal title="Budget request" onClose={() => setShow(false)}>
          <div className="erp-form">
            <label>Request date<input type="date" className="input" value={f.requestDate} onChange={(e) => setF({ ...f, requestDate: e.target.value })} /></label>
            <label>Cost (₹)<input type="number" className="input" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></label>
            <label>Start<input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
            <label>End<input type="date" className="input" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
            <label>Reason<select className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{REASONS.map(r => <option key={r}>{r}</option>)}</select></label>
            <label className="full">Remarks<input className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} placeholder="e.g. Budget for October 2026" /></label>
          </div>
          <div className="erp-modal-actions"><button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn btn-primary" disabled={!Number(f.cost)} onClick={async () => { try { await erpCreateBudgetRequest(projectId, { ...f, cost: Number(f.cost) }); setShow(false); setF({ ...f, cost: '', remarks: '' }); load(); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } }}>Submit request</button></div>
        </Modal>
      )}
    </>
  );
}

// ─── Expenses ───────────────────────────────────────────────────────────────
function Expenses({ projects, projectId }) {
  const fy = fyOf(); const [filt, setFilt] = useState({ projectId: projectId || '', planType: '', from: fyRange(fy).from, to: fyRange(fy).to });
  const [rows, setRows] = useState([]); const [show, setShow] = useState(false); const [msg, setMsg] = useState(null);
  const [f, setF] = useState({ projectId: projectId || '', date: todayIso(), expenseType: EXPENSE_TYPES[0], planType: 'Actual', amount: '', note: '' });
  const load = () => erpExpenses(Object.fromEntries(Object.entries(filt).filter(([, v]) => v))).then(r => setRows(r.data)).catch(() => {});
  useAsync(() => load(), [filt]);
  useAsync(() => { setFilt(x => ({ ...x, projectId: projectId || '' })); setF(x => ({ ...x, projectId: projectId || '' })); }, [projectId]);
  return (
    <>
      <div className="erp-toolbar">
        <label className="erp-field"><span>Project</span><select className="input" value={filt.projectId} onChange={(e) => setFilt({ ...filt, projectId: e.target.value })}><option value="">All</option>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>
        <label className="erp-field"><span>Plan type</span><select className="input" value={filt.planType} onChange={(e) => setFilt({ ...filt, planType: e.target.value })}><option value="">All</option>{PLAN_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="erp-field"><span>From</span><input type="date" className="input" value={filt.from} onChange={(e) => setFilt({ ...filt, from: e.target.value })} /></label>
        <label className="erp-field"><span>To</span><input type="date" className="input" value={filt.to} onChange={(e) => setFilt({ ...filt, to: e.target.value })} /></label>
        <span className="spacer" /><button className="btn btn-primary btn-sm" onClick={() => setShow(true)}>+ Add expense</button>
      </div>
      {msg && <Banner kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Banner>}
      <div className="erp-tablewrap">
        <table className="erp-table">
          <thead><tr><th>Date</th><th>Project</th><th>Type</th><th>Plan</th><th className="num">Amount</th><th>Note</th><th>By</th><th /></tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={8}><Empty>No expenses for these filters.</Empty></td></tr>}
            {rows.map(r => <tr key={r._id}><td>{fmtDate(r.date)}</td><td className="name">{r.projectName}</td><td>{r.expenseType}</td><td><span className="erp-status draft">{r.planType}</span></td><td className="num">{fmtINR(r.amount)}</td><td className="dim">{r.note}</td><td>{r.createdBy}</td><td><button className="btn btn-icon" title="Delete" onClick={async () => { if (window.confirm('Delete this expense?')) { try { await erpDeleteExpense(r._id); load(); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } } }}>×</button></td></tr>)}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td colSpan={4}>Total</td><td className="num">{fmtINR(rows.reduce((a, r) => a + r.amount, 0))}</td><td colSpan={3} /></tr></tfoot>}
        </table>
      </div>
      {show && (
        <Modal title="Add expense" onClose={() => setShow(false)}>
          <div className="erp-form">
            <label className="full">Project<select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">Select…</option>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>
            <label>Date<input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label>Amount (₹)<input type="number" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
            <label>Expense type<select className="input" value={f.expenseType} onChange={(e) => setF({ ...f, expenseType: e.target.value })}>{EXPENSE_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
            <label>Plan type<select className="input" value={f.planType} onChange={(e) => setF({ ...f, planType: e.target.value })}>{PLAN_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
            <label className="full">Note<input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          </div>
          <div className="erp-modal-actions"><button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn btn-primary" disabled={!f.projectId || !Number(f.amount)} onClick={async () => { try { await erpCreateExpense({ ...f, amount: Number(f.amount) }); setShow(false); setF({ ...f, amount: '', note: '' }); load(); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } }}>Add</button></div>
        </Modal>
      )}
    </>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function ErpPnlPage() {
  const { me } = useErpMe();
  const jump = useMemo(() => erpTakeJump('pnl'), []);
  const [tab, setTab] = useState(jump?.tab || 'summary');
  const [projects, setProjects] = useState([]); const [team, setTeam] = useState([]);
  const [projectSel, setProjectId] = useState(jump?.projectId || '');
  const reload = () => erpProjects().then(r => setProjects(r.data)).catch(() => {});
  useEffect(() => { reload(); getTeam().then(r => setTeam(r.data)).catch(() => {}); }, []);
  const projectId = projectSel || projects[0]?._id || '';
  const project = projects.find(p => p._id === projectId);
  const openProject = (id) => { setProjectId(id); setTab('project'); };
  const money = me?.canSeeMoney;
  const needsProject = ['planned', 'project', 'budget'].includes(tab);

  return (
    <div className="erp-page">
      <PageHead title="Profit & Loss" subtitle="Budget requests become the plan, planned hours × rate card become the planned cost, approved timesheets become the actual, and the summary shows the margin per project." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'summary', label: 'Summary' }, { id: 'projects', label: 'Projects' }, { id: 'project', label: 'Project P&L' }, { id: 'planned', label: 'Planned cost' }, { id: 'budget', label: 'Budget requests' }, { id: 'expenses', label: 'Expenses' }]} />
      {needsProject && (
        <div className="erp-toolbar">
          <label className="erp-field grow"><span>Project</span><select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map(p => <option key={p._id} value={p._id}>{p.name}{p.client ? ` · ${p.client}` : ''}</option>)}</select></label>
          {project && <span className="erp-note">{project.type || 'Others'} · {project.status || 'Active'} · {fmtDate(project.startDate)} – {fmtDate(project.endDate)} · manager {project.managerName || '—'}</span>}
        </div>
      )}
      {me && !money && tab !== 'projects' && tab !== 'expenses' && <Empty>Profit &amp; Loss figures are available to managers and admins. You can still log expenses and see project setup.</Empty>}
      {tab === 'summary' && money && <Summary onOpen={openProject} />}
      {tab === 'projects' && <Projects me={me} projects={projects} team={team} reload={reload} onOpen={openProject} />}
      {tab === 'project' && money && projectId && <ProjectPl projectId={projectId} />}
      {tab === 'planned' && money && projectId && <Planned projectId={projectId} project={project} />}
      {tab === 'budget' && money && projectId && <Budget me={me} projectId={projectId} project={project} />}
      {tab === 'expenses' && <Expenses projects={projects} projectId={projectId} />}
    </div>
  );
}
