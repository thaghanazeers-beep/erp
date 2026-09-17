import { useEffect, useMemo, useState } from 'react';
import Avatar from '../../components/Avatar';
import { erpMyDashboard, erpTeamDashboard, getTeam } from '../../api';
import { useErpMe } from './erpHooks';
import { PageHead, StatusChip, Empty, Tabs, ComplianceStrip } from './ErpBits';
import { fmtHM, erpJump, erpTakeJump } from './erpUtils';

export default function ErpTeamPage() {
  const { me } = useErpMe();
  const jump = useMemo(() => erpTakeJump('erp-team'), []);
  const [tab, setTab] = useState(jump ? 'team' : 'me');
  const [mine, setMine] = useState([]);
  const [rows, setRows] = useState([]);
  const [all, setAll] = useState(false);
  const [team, setTeam] = useState([]);
  const [onlyProblems, setOnlyProblems] = useState(false);

  useEffect(() => { erpMyDashboard().then(r => setMine(r.data)).catch(() => {}); getTeam().then(r => setTeam(r.data)).catch(() => {}); }, []);
  useEffect(() => { if (tab === 'team') erpTeamDashboard(all).then(r => setRows(r.data)).catch(() => {}); }, [tab, all]);

  const people = useMemo(() => { const m = new Map(); rows.forEach(r => { if (!m.has(r.userId)) m.set(r.userId, { userId: r.userId, userName: r.userName, weeks: [] }); m.get(r.userId).weeks.push(r); }); return [...m.values()].sort((a, b) => a.userName.localeCompare(b.userName)); }, [rows]);
  const weeks = useMemo(() => { const seen = new Map(); rows.forEach(r => seen.set(`${r.year}-${r.week}`, r)); return [...seen.values()].map(r => ({ year: r.year, week: r.week, range: r.range })); }, [rows]);
  const problem = (w) => w.status === 'missing' || w.status === 'rejected' || (w.status === 'draft');

  return (
    <div className="erp-page">
      <PageHead title="Timesheet dashboard" subtitle="Your last eight weeks at a glance, and — for managers — whether each team member has keyed in and been approved." />
      <ComplianceStrip />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'me', label: 'My dashboard' }, ...(me?.isManager || me?.isAdmin ? [{ id: 'team', label: 'Team dashboard' }] : [])]} />

      {tab === 'me' && (
        <div className="erp-tablewrap">
          <table className="erp-table">
            <thead><tr><th>Week</th><th>Date range</th><th className="num">Time logged</th><th>Status</th><th /></tr></thead>
            <tbody>
              {mine.map(w => <tr key={`${w.year}-${w.week}`}><td className="name">Week {w.week} · {w.year}</td><td>{w.range}</td><td className="num">{fmtHM(w.minutes)}</td><td><StatusChip status={w.status} /></td><td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-sm" onClick={() => erpJump('timesheet', { year: w.year, week: w.week })}>{['missing', 'draft', 'rejected'].includes(w.status) ? 'Fill in' : 'Open'}</button></td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'team' && (
        <>
          <div className="erp-toolbar">
            {me?.isAdmin && <label className="erp-note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All employees (not only my reports)</label>}
            <label className="erp-note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only weeks needing attention</label>
            <span className="spacer" />
            <span className="erp-note">{people.length} people · {weeks.length} weeks</span>
          </div>
          {!people.length && <Empty>Nobody is allocated to you yet. Assign people under ERP › Resources › Allocation.</Empty>}
          {people.length > 0 && (
            <div className="erp-tablewrap">
              <table className="erp-table">
                <thead><tr><th className="sticky">Person</th>{weeks.map(w => <th key={`${w.year}-${w.week}`} className="c" title={w.range}>Wk {w.week}<br /><span className="sub">{w.range}</span></th>)}<th>Approval pending by</th></tr></thead>
                <tbody>
                  {people.filter(p => !onlyProblems || p.weeks.some(problem)).map(p => (
                    <tr key={p.userId}>
                      <td className="sticky name"><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Avatar name={p.userName} members={team} size={22} />{p.userName}</span></td>
                      {weeks.map(w => { const x = p.weeks.find(y => y.year === w.year && y.week === w.week); return (
                        <td key={`${w.year}-${w.week}`} className="c clickable" onClick={() => erpJump(x?.status === 'submitted' ? 'approvals' : 'timesheet', { year: w.year, week: w.week, userId: p.userId })} title={x ? `${fmtHM(x.minutes)} · ${x.status}` : ''}>
                          {x ? <><StatusChip status={x.status} /><div className="sub">{x.keyedIn ? fmtHM(x.minutes) : '—'}</div></> : ''}
                        </td>); })}
                      <td className="dim">{p.weeks[0]?.approvers.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
