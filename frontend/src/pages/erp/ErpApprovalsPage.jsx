import { useEffect, useMemo, useState } from 'react';
import Avatar from '../../components/Avatar';
import { erpApprovals, erpPending, erpApproveTimesheet, erpRejectTimesheet, erpReopenTimesheet, erpProjects, getTeam } from '../../api';
import { useErpMe, useWeeks, useAsync } from './erpHooks';
import { PageHead, WeekPicker, StatusChip, Banner, Empty, Tabs } from './ErpBits';
import { fmtHM, dayLabel, DOW, sum, errMsg, erpTakeJump, erpJump, downloadCsv } from './erpUtils';

export default function ErpApprovalsPage() {
  const { me } = useErpMe();
  const jump = useMemo(() => erpTakeJump('approvals'), []);
  const [tab, setTab] = useState('week');
  const [year, setYear] = useState(jump?.year || new Date().getFullYear());
  const [weekSel, setWeek] = useState(jump?.week || 0);
  const [projectId, setProjectId] = useState('');
  const weeks = useWeeks(year);
  const [data, setData] = useState(null);
  const [pending, setPending] = useState([]);
  const [projects, setProjects] = useState([]);
  const [team, setTeam] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState({});

  const week = weekSel || me?.currentWeek.week || 0;
  useEffect(() => { erpProjects().then(r => setProjects(r.data)).catch(() => {}); getTeam().then(r => setTeam(r.data)).catch(() => {}); }, []);
  const loadPending = () => erpPending().then(r => setPending(r.data)).catch(() => {});
  useEffect(() => { loadPending(); }, []);
  const load = async () => { if (!week) return; setBusy(true); try { const r = await erpApprovals(year, week, projectId || undefined); setData(r.data); setSelected({}); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } finally { setBusy(false); } };
  useAsync(() => load(), [year, week, projectId]);

  const act = async (id, action, note) => {
    setBusy(true); setMsg(null);
    try {
      if (action === 'approve') await erpApproveTimesheet(id, note); else if (action === 'reject') await erpRejectTimesheet(id, note); else await erpReopenTimesheet(id, note);
      await load(); await loadPending(); setMsg({ kind: 'ok', text: `Timesheet ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reopened'}.` });
    } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } finally { setBusy(false); }
  };
  const bulk = async (action) => {
    const ids = Object.keys(selected).filter(k => selected[k]); if (!ids.length) return;
    const note = action === 'reject' ? (window.prompt('Reason for rejecting these timesheets?') ?? null) : '';
    if (note === null) return;
    for (const id of ids) await act(id, action, note);
  };
  const submitted = (data?.sheets || []).filter(s => s.status === 'submitted');

  if (me && !me.isManager && !me.isAdmin) return <div className="erp-page"><PageHead title="Approvals" /><Empty>Nobody is allocated to you for approval. An admin can assign people to you under ERP › Resources › Allocation, or in the organisation chart.</Empty></div>;

  return (
    <div className="erp-page">
      <PageHead title="Timesheet approvals" subtitle="Review the weeks your people submitted. Approving locks the week; rejecting sends it back with your note.">
        <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`pending-approvals.csv`, [['Person', 'Year', 'Week', 'Range', 'Hours', 'Submitted', 'Days waiting', 'Approvers'], ...pending.map(p => [p.userName, p.year, p.week, p.range, fmtHM(p.totalMinutes), p.submittedAt?.slice(0, 10), p.daysWaiting, p.approvers.join('; ')])])}>Export backlog</button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'week', label: 'Approve by week' }, { id: 'pending', label: 'Pending backlog', count: pending.length }]} />
      {msg && <Banner kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Banner>}

      {tab === 'week' && (
        <>
          <div className="erp-toolbar">
            <WeekPicker year={year} week={week || 1} weeks={weeks} onChange={(y, wk) => { setYear(y); setWeek(wk); }} />
            <label className="erp-field"><span>Project</span>
              <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
            </label>
          </div>
          {data?.pendingWeeks?.length > 0 && (
            <div className="erp-chips"><span className="erp-note" style={{ alignSelf: 'center' }}>Weeks with sheets waiting:</span>
              {data.pendingWeeks.map(p => <button key={`${p.year}-${p.week}`} className={`erp-chip ${p.year === year && p.week === week ? 'on' : 'warn'}`} onClick={() => { setYear(p.year); setWeek(p.week); }}>Week {p.week} · {p.year} ({p.count})</button>)}
            </div>
          )}
          {submitted.length > 1 && (
            <div className="ts-actions">
              <label className="erp-note" style={{ marginRight: 'auto' }}><input type="checkbox" checked={submitted.every(s => selected[s._id])} onChange={(e) => setSelected(Object.fromEntries(submitted.map(s => [s._id, e.target.checked])))} /> Select all awaiting ({submitted.length})</label>
              <button className="btn btn-reject btn-sm" disabled={busy} onClick={() => bulk('reject')}>Reject selected</button>
              <button className="btn btn-approve btn-sm" disabled={busy} onClick={() => bulk('approve')}>Approve selected</button>
            </div>
          )}
          {data && !data.sheets.length && <Empty>No timesheets from your people for {data.week.label}.</Empty>}
          {data?.sheets.map(s => (
            <div key={s._id} className="appr-card">
              <div className="appr-head">
                {s.status === 'submitted' && <input type="checkbox" checked={!!selected[s._id]} onChange={(e) => setSelected(x => ({ ...x, [s._id]: e.target.checked }))} />}
                <span className="who"><Avatar name={s.userName} members={team} size={24} />{s.userName}</span>
                <StatusChip status={s.status} />
                <span className="meta">{fmtHM(s.totalMinutes)} · {s.rows.length} row{s.rows.length === 1 ? '' : 's'}{s.submittedAt ? ` · submitted ${new Date(s.submittedAt).toLocaleDateString()}` : ''}{s.decidedBy ? ` · ${s.status} by ${s.decidedBy}` : ''}</span>
                <span className="acts">
                  <button className="btn btn-ghost btn-sm" onClick={() => erpJump('timesheet', { year, week, userId: s.userId })}>Open</button>
                  {s.status === 'submitted' && <button className="btn btn-reject btn-sm" disabled={busy} onClick={() => { const n = window.prompt(`Reason for rejecting ${s.userName}'s week?`); if (n !== null) act(s._id, 'reject', n); }}>Reject</button>}
                  {s.status === 'submitted' && <button className="btn btn-approve btn-sm" disabled={busy} onClick={() => act(s._id, 'approve', '')}>Approve</button>}
                  {s.status === 'approved' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { if (window.confirm('Reopen this approved week so it can be edited?')) act(s._id, 'reopen', ''); }}>Reopen</button>}
                </span>
              </div>
              <div className="erp-tablewrap">
                <table className="erp-table">
                  <thead><tr><th>Project</th><th>Sprint</th><th>Category</th>{s.days.map((d, i) => <th key={d} className="c">{dayLabel(d)}<br /><span className="sub">{DOW[i]}</span></th>)}<th className="num">Total</th></tr></thead>
                  <tbody>
                    {s.rows.map((r, i) => <tr key={i}><td className="name">{r.projectName}</td><td>{r.sprintName || <span className="dim">—</span>}</td><td>{r.category || <span className="dim">—</span>}</td>{r.minutes.map((m, j) => <td key={j} className="c">{m ? fmtHM(m) : <span className="dim">·</span>}</td>)}<td className="num" style={{ fontWeight: 600 }}>{fmtHM(sum(r.minutes))}</td></tr>)}
                    <tr className="total"><td colSpan={3}>Day total</td>{s.days.map((_, j) => <td key={j} className="c">{fmtHM(sum(s.rows.map(r => r.minutes[j])))}</td>)}<td className="num">{fmtHM(s.totalMinutes)}</td></tr>
                  </tbody>
                </table>
              </div>
              {s.note && <div className="erp-note">Note: {s.note}</div>}
            </div>
          ))}
          {data?.notSubmitted?.length > 0 && <div className="erp-card"><h3>Not submitted this week</h3><div className="erp-chips">{data.notSubmitted.map(n => <span key={n} className="erp-chip warn">{n}</span>)}</div></div>}
        </>
      )}

      {tab === 'pending' && (
        <div className="erp-tablewrap">
          <table className="erp-table">
            <thead><tr><th>Person</th><th>Week</th><th>Range</th><th className="num">Hours</th><th>Submitted</th><th className="num">Days waiting</th><th>Approvers</th><th /></tr></thead>
            <tbody>
              {!pending.length && <tr><td colSpan={8}><Empty>Nothing is waiting for approval.</Empty></td></tr>}
              {pending.map(p => (
                <tr key={p._id}>
                  <td className="name">{p.userName}</td><td>Week {p.week} · {p.year}</td><td>{p.range}</td><td className="num">{fmtHM(p.totalMinutes)}</td><td>{p.submittedAt ? new Date(p.submittedAt).toLocaleDateString() : ''}</td>
                  <td className="num" style={{ color: p.daysWaiting > 7 ? 'var(--accent-red)' : undefined, fontWeight: p.daysWaiting > 7 ? 600 : 400 }}>{p.daysWaiting}</td><td className="dim">{p.approvers.join(', ') || '—'}</td>
                  <td><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}><button className="btn btn-ghost btn-sm" onClick={() => { setTab('week'); setYear(p.year); setWeek(p.week); }}>Review</button><button className="btn btn-approve btn-sm" disabled={busy} onClick={() => act(p._id, 'approve', '')}>Approve</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
