import { useMemo, useState } from 'react';
import { erpGetTimesheet, erpSaveTimesheet, erpSubmitTimesheet, erpCopyPreviousWeek } from '../../api';
import { useErpMe, useWeeks, useAsync } from './erpHooks';
import { PageHead, WeekPicker, StatusChip, Banner, ComplianceStrip } from './ErpBits';
import { fmtHM, fmtHMSigned, parseHM, dayLabel, DOW, sum, errMsg, erpTakeJump, fmtDate } from './erpUtils';

const blankRow = () => ({ projectId: '', sprintId: '', category: '', minutes: [0, 0, 0, 0, 0, 0, 0] });

/** Hours cell: free typing, normalised to hh:mm on blur. */
function HourCell({ value, disabled, onChange }) {
  const [text, setText] = useState(value ? fmtHM(value) : '');
  const [bad, setBad] = useState(false);
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(value ? fmtHM(value) : ''); } // re-sync when the saved value changes
  return (
    <input className={`input cell ${disabled ? 'off' : ''} ${bad ? 'bad' : ''}`} value={text} disabled={disabled} placeholder="00:00" inputMode="numeric"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const m = parseHM(text); if (m == null) { setBad(true); return; } setBad(false); setText(m ? fmtHM(m) : ''); onChange(m); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

export default function ErpTimesheetPage() {
  const { me } = useErpMe();
  const jump = useMemo(() => erpTakeJump('timesheet'), []);
  const [year, setYear] = useState(jump?.year || new Date().getFullYear());
  const [weekSel, setWeek] = useState(jump?.week || 0);
  const [userId, setUserId] = useState(jump?.userId || '');
  const weeks = useWeeks(year);
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {kind, text}

  const week = weekSel || me?.currentWeek.week || 0;

  const load = async () => {
    if (!week) return;
    setBusy(true); setMsg(null);
    try { const r = await erpGetTimesheet(year, week, userId || undefined); setData(r.data); setRows(r.data.sheet.rows.length ? r.data.sheet.rows.map(x => ({ ...x, minutes: [...x.minutes] })) : [blankRow()]); setDirty(false); }
    catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); }
    finally { setBusy(false); }
  };
  useAsync(() => load(), [year, week, userId]);

  const readOnly = !!userId && userId !== me?.user.id;
  const locked = readOnly || ['submitted', 'approved'].includes(data?.sheet?.status);
  const w = data?.week;
  const inRange = (d) => w && d >= w.start && d <= w.end;
  const isWeekend = (i) => i >= 5;

  const projectById = useMemo(() => Object.fromEntries((data?.projects || []).map(p => [p._id, p])), [data]);
  const savedByProject = useMemo(() => { const o = {}; (data?.sheet?.rows || []).forEach(r => { o[r.projectId] = (o[r.projectId] || 0) + sum(r.minutes); }); return o; }, [data]);
  const currentByProject = useMemo(() => { const o = {}; rows.forEach(r => { if (r.projectId) o[r.projectId] = (o[r.projectId] || 0) + sum(r.minutes); }); return o; }, [rows]);
  const remainingFor = (pid) => { const p = projectById[pid]; if (!p) return null; return p.remainingMinutes + (savedByProject[pid] || 0) - (currentByProject[pid] || 0); };

  const setRow = (i, patch) => { setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true); };
  const setMin = (i, d, m) => { setRows(rs => rs.map((r, j) => { if (j !== i) return r; const minutes = [...r.minutes]; minutes[d] = m; return { ...r, minutes }; })); setDirty(true); };
  const dayTotals = Array.from({ length: 7 }, (_, d) => sum(rows.map(r => r.minutes[d])));
  const weekTotal = sum(dayTotals);
  const validRows = () => rows.filter(r => r.projectId);

  const save = async (thenSubmit = false) => {
    setBusy(true); setMsg(null);
    try {
      const payload = { year, week, rows: validRows() };
      if (thenSubmit) { const r = await erpSubmitTimesheet(payload); setData(d => ({ ...d, sheet: r.data })); setDirty(false); setMsg({ kind: 'ok', text: 'Submitted for approval. Your manager has been notified.' }); }
      else { const r = await erpSaveTimesheet(payload); setData(d => ({ ...d, sheet: r.data })); setDirty(false); setMsg({ kind: 'ok', text: 'Saved as draft.' }); }
      await load();
    } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); }
    finally { setBusy(false); }
  };
  const copyPrev = async () => { setBusy(true); try { await erpCopyPreviousWeek(year, week); await load(); setMsg({ kind: 'info', text: 'Rows copied from last week. Fill in the hours and save.' }); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } finally { setBusy(false); } };

  const sheet = data?.sheet;
  return (
    <div className="erp-page">
      <PageHead title="Timesheet" subtitle="Log hours per project, sprint and booking category for each day of the week, then submit the week for approval.">
        {sheet && <StatusChip status={sheet.status} />}
      </PageHead>
      {!readOnly && <ComplianceStrip compact />}

      <div className="erp-toolbar">
        <WeekPicker year={year} week={week || 1} weeks={weeks} onChange={(y, wk) => { if (dirty && !window.confirm('Discard unsaved changes?')) return; setYear(y); setWeek(wk); }} />
        {me?.isManager && (
          <label className="erp-field"><span>Person</span>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Me ({me.user.name})</option>
              {me.reports.map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {msg && <Banner kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Banner>}
      {sheet?.status === 'rejected' && <Banner kind="err">Rejected by {sheet.decidedBy}{sheet.note ? `: ${sheet.note}` : ''}. Fix the hours and submit again.</Banner>}
      {sheet?.status === 'submitted' && <Banner kind="warn">Waiting for approval since {new Date(sheet.submittedAt).toLocaleString()}. Ask your manager to reopen it if you need to change hours.</Banner>}
      {sheet?.status === 'approved' && <Banner kind="ok">Approved by {sheet.decidedBy} on {sheet.decidedAt ? new Date(sheet.decidedAt).toLocaleDateString() : ''}.</Banner>}
      {readOnly && <Banner kind="info">Viewing {data?.userName}'s week (read-only).</Banner>}

      {data && (
        <div className="erp-tablewrap">
          <table className="erp-table ts-grid">
            <thead>
              <tr>
                <th style={{ minWidth: 165 }}>Project</th><th style={{ minWidth: 110 }}>Sprint</th><th style={{ minWidth: 125 }}>Category</th><th className="c">Remaining</th>
                {w.days.map((d, i) => <th key={d} className="day">{dayLabel(d)}<small>{DOW[i]}</small></th>)}
                <th className="c">Total</th>{!locked && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const p = projectById[r.projectId]; const rem = remainingFor(r.projectId);
                return (
                  <tr key={i}>
                    <td>
                      <select className="input" value={r.projectId} disabled={locked} onChange={(e) => setRow(i, { projectId: e.target.value, sprintId: '', category: projectById[e.target.value]?.categories?.[0] || '' })}>
                        <option value="">Select project…</option>
                        {data.projects.map(pr => <option key={pr._id} value={pr._id}>{pr.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={r.sprintId} disabled={locked || !p} onChange={(e) => setRow(i, { sprintId: e.target.value })}>
                        <option value="">—</option>
                        {(p?.sprints || []).map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={r.category} disabled={locked || !p} onChange={(e) => setRow(i, { category: e.target.value })}>
                        <option value="">—</option>
                        {(p?.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className={`rem ${rem == null ? '' : rem < 0 ? 'neg' : 'pos'}`} title={p ? `Planned ${fmtHM(p.plannedMinutes)} · booked ${fmtHM(p.bookedMinutes)} this financial year` : ''}>{rem == null ? '—' : fmtHMSigned(rem)}</td>
                    {w.days.map((d, di) => <td key={d} className="c"><HourCell value={r.minutes[di]} disabled={locked || !inRange(d) || !r.projectId} onChange={(m) => setMin(i, di, m)} /></td>)}
                    <td className="c" style={{ fontWeight: 600 }}>{fmtHM(sum(r.minutes))}</td>
                    {!locked && <td className="c"><button className="btn btn-icon" title="Remove row" onClick={() => { setRows(rs => rs.filter((_, j) => j !== i)); setDirty(true); }}>×</button></td>}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={12} className="erp-empty">No rows yet. Add a row or copy last week.</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ textAlign: 'right' }}>Day total</td>
                {w.days.map((d, i) => { const t = dayTotals[i]; const cls = !inRange(d) ? 'off' : isWeekend(i) ? (t ? 'ok' : 'off') : t >= 480 ? 'ok' : t > 0 ? 'low' : 'none'; return <td key={d} className={`daytotal ${cls}`}>{fmtHM(t)}</td>; })}
                <td className="c">{fmtHM(weekTotal)}</td>{!locked && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {data && !locked && (
        <div className="ts-actions">
          <span className="erp-note">{w.start !== w.days[0] || w.end !== w.days[6] ? `Only ${fmtDate(w.start)} – ${fmtDate(w.end)} belong to week ${week}; other days are greyed out.` : ''}</span>
          <button className="btn btn-ghost" disabled={busy} onClick={() => { setRows(rs => [...rs, blankRow()]); }}>+ Add row</button>
          <button className="btn btn-ghost" disabled={busy} onClick={copyPrev}>Copy last week</button>
          <button className="btn btn-ghost" disabled={busy || !dirty} onClick={() => save(false)}>Save draft</button>
          <button className="btn btn-primary" disabled={busy || !weekTotal} onClick={() => { if (window.confirm(`Submit ${fmtHM(weekTotal)} for week ${week} for approval?`)) save(true); }}>Submit for approval</button>
        </div>
      )}

      {sheet?.history?.length > 0 && (
        <div className="erp-card"><h3>History</h3>
          <ul className="erp-hist">{[...sheet.history].reverse().slice(0, 8).map((h, i) => <li key={i}><b>{h.by}</b> {h.action} · {new Date(h.at).toLocaleString()}{h.note ? ` — ${h.note}` : ''}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
