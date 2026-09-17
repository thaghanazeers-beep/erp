import { useEffect, useState } from 'react';
import Avatar from '../../components/Avatar';
import { erpAllocations, erpSaveAllocation, erpCosts, erpAddCost, erpDeleteCost, erpHolidays, erpAddHoliday, erpDeleteHoliday, erpHierarchy, getTeam } from '../../api';
import { useErpMe, useAsync } from './erpHooks';
import { PageHead, Tabs, Banner, Empty } from './ErpBits';
import { fmtINR, fmtDate, todayIso, errMsg, downloadCsv } from './erpUtils';

const RESOURCE_TYPES = ['Trainee', 'Junior', 'Associate', 'Senior', 'Lead', 'Management', 'Consultant'];

function Allocation({ me, team }) {
  const [rows, setRows] = useState([]); const [managerSel, setManagerId] = useState(''); const [sel, setSel] = useState([]); const [msg, setMsg] = useState(null); const [q, setQ] = useState('');
  const load = () => erpAllocations().then(r => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);
  const managerId = managerSel || me?.user.id || '';
  useAsync(() => setSel(rows.find(r => r.managerId === managerId)?.userIds || []), [managerId, rows]);
  const canEdit = me?.isAdmin || me?.user.role === 'Team Owner' || managerId === me?.user.id;
  const save = async () => { try { await erpSaveAllocation(managerId, sel); await load(); setMsg({ kind: 'ok', text: 'Allocation saved. These people now appear in the manager’s approvals and team dashboard.' }); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } };
  const list = team.filter(u => u._id !== managerId && (!q || u.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="erp-toolbar">
        <label className="erp-field grow"><span>Project manager / approver</span><select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>{team.map(u => <option key={u._id} value={u._id}>{u.name}{rows.find(r => r.managerId === u._id)?.userIds.length ? ` (${rows.find(r => r.managerId === u._id).userIds.length})` : ''}</option>)}</select></label>
        <label className="erp-field grow"><span>Find person</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name" /></label>
        <button className="btn btn-primary btn-sm" disabled={!canEdit} onClick={save}>Save allocation</button>
      </div>
      {msg && <Banner kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Banner>}
      <div className="erp-tablewrap"><table className="erp-table">
        <thead><tr><th>Person</th><th className="c">Reports to this manager</th><th>Also allocated to</th></tr></thead>
        <tbody>{list.map(u => <tr key={u._id}><td className="name"><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Avatar name={u.name} members={team} size={22} />{u.name}</span></td><td className="c"><input type="checkbox" disabled={!canEdit} checked={sel.includes(u._id)} onChange={(e) => setSel(s => (e.target.checked ? [...s, u._id] : s.filter(x => x !== u._id)))} /></td><td className="dim">{rows.filter(r => r.managerId !== managerId && r.userIds.includes(u._id)).map(r => r.managerName).join(', ') || '—'}</td></tr>)}</tbody>
      </table></div>
      <p className="erp-note">Allocation decides who approves whose timesheets and who appears on a manager's team dashboard. The organisation chart adds direct and indirect reports automatically; use this list for people who report outside the chart.</p>
    </>
  );
}

function RateCard({ me, team }) {
  const [rows, setRows] = useState([]); const [msg, setMsg] = useState(null); const [q, setQ] = useState('');
  const [f, setF] = useState({ userId: '', resourceType: 'Junior', dailyCost: '', effectiveDate: todayIso() });
  const load = () => erpCosts().then(r => setRows(r.data)).catch(e => setMsg({ kind: 'err', text: errMsg(e) }));
  useEffect(() => { load(); }, []);
  const latest = {}; rows.forEach(r => { if (!latest[r.userId]) latest[r.userId] = r; });
  const missing = team.filter(u => !latest[u._id]);
  const list = rows.filter(r => !q || r.userName.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      {me?.isAdmin && (
        <div className="erp-toolbar">
          <label className="erp-field grow"><span>Employee</span><select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Select…</option>{team.map(u => <option key={u._id} value={u._id}>{u.name}{latest[u._id] ? '' : ' (no rate yet)'}</option>)}</select></label>
          <label className="erp-field"><span>Type</span><select className="input" value={f.resourceType} onChange={(e) => setF({ ...f, resourceType: e.target.value })}>{RESOURCE_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
          <label className="erp-field"><span>Daily cost (₹)</span><input type="number" className="input" value={f.dailyCost} onChange={(e) => setF({ ...f, dailyCost: e.target.value })} placeholder="e.g. 4008" /></label>
          <label className="erp-field"><span>Effective from</span><input type="date" className="input" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></label>
          <button className="btn btn-primary btn-sm" disabled={!f.userId || !Number(f.dailyCost)} onClick={async () => { try { await erpAddCost({ ...f, dailyCost: Number(f.dailyCost) }); setF({ ...f, userId: '', dailyCost: '' }); load(); setMsg({ kind: 'ok', text: 'Rate added.' }); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } }}>Add rate</button>
        </div>
      )}
      <div className="erp-toolbar"><label className="erp-field grow"><span>Search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" /></label><span className="erp-note">{Object.keys(latest).length} people with a rate · {missing.length} without</span><button className="btn btn-ghost btn-sm" onClick={() => downloadCsv('rate-card.csv', [['Resource', 'Type', 'Daily cost', 'Hourly', 'Effective'], ...rows.map(r => [r.userName, r.resourceType, r.dailyCost, (r.dailyCost / 8).toFixed(2), r.effectiveDate])])}>Export CSV</button></div>
      {msg && <Banner kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Banner>}
      <div className="erp-tablewrap"><table className="erp-table">
        <thead><tr><th>Resource</th><th>Type</th><th className="num">Daily cost</th><th className="num">Hourly</th><th className="num">Monthly (21 d)</th><th>Effective from</th><th /></tr></thead>
        <tbody>
          {!list.length && <tr><td colSpan={7}><Empty>No rates yet. {me?.isAdmin ? 'Add one above.' : ''}</Empty></td></tr>}
          {list.map(r => <tr key={r._id} style={latest[r.userId]?._id === r._id ? undefined : { opacity: 0.55 }}><td className="name">{r.userName}{latest[r.userId]?._id !== r._id && <span className="sub"> (superseded)</span>}</td><td>{r.resourceType}</td><td className="num">{fmtINR(r.dailyCost)}</td><td className="num">{fmtINR(r.dailyCost / 8)}</td><td className="num">{fmtINR(r.dailyCost * 21)}</td><td>{fmtDate(r.effectiveDate)}</td><td>{me?.isAdmin && <button className="btn btn-icon" title="Delete" onClick={async () => { if (window.confirm('Delete this rate entry?')) { await erpDeleteCost(r._id); load(); } }}>×</button>}</td></tr>)}
        </tbody>
      </table></div>
      {missing.length > 0 && <div className="erp-card"><h3>No rate yet</h3><div className="erp-chips">{missing.map(u => <span key={u._id} className="erp-chip warn">{u.name}</span>)}</div><p className="erp-note">Hours these people log cost ₹0 in Profit &amp; Loss until a rate is added.</p></div>}
    </>
  );
}

function Holidays({ me }) {
  const [year, setYear] = useState(new Date().getFullYear()); const [rows, setRows] = useState([]); const [f, setF] = useState({ date: '', name: '' }); const [msg, setMsg] = useState(null);
  const load = () => erpHolidays(year).then(r => setRows(r.data)).catch(() => {});
  useAsync(() => load(), [year]);
  return (
    <>
      <div className="erp-toolbar">
        <label className="erp-field"><span>Year</span><select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].map(y => <option key={y}>{y}</option>)}</select></label>
        {me?.isAdmin && <><label className="erp-field"><span>Date</span><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label><label className="erp-field grow"><span>Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Diwali" /></label><button className="btn btn-primary btn-sm" disabled={!f.date} onClick={async () => { try { await erpAddHoliday(f); setF({ date: '', name: '' }); load(); } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }); } }}>Add holiday</button></>}
      </div>
      {msg && <Banner kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Banner>}
      <div className="erp-tablewrap"><table className="erp-table"><thead><tr><th>Date</th><th>Holiday</th><th /></tr></thead>
        <tbody>{!rows.length && <tr><td colSpan={3}><Empty>No holidays recorded for {year}. Weekends are always excluded from compliance and working-day counts.</Empty></td></tr>}{rows.map(h => <tr key={h._id}><td>{fmtDate(h.date)}</td><td className="name">{h.name}</td><td>{me?.isAdmin && <button className="btn btn-icon" onClick={async () => { await erpDeleteHoliday(h._id); load(); }}>×</button>}</td></tr>)}</tbody></table></div>
    </>
  );
}

function Tree({ nodes, team }) {
  if (!nodes?.length) return null;
  return (
    <ul className="org-tree">{nodes.map(n => <li key={n.id}><div className="org-node"><Avatar name={n.name} src={n.avatar || undefined} members={team} size={28} /><div><b>{n.name}</b><small>{[n.role, n.department].filter(Boolean).join(' · ') || 'Member'}</small></div></div><Tree nodes={n.children} team={team} /></li>)}</ul>
  );
}
function Hierarchy({ team }) {
  const [d, setD] = useState(null);
  useEffect(() => { erpHierarchy().then(r => setD(r.data)).catch(() => {}); }, []);
  if (!d) return null;
  if (!d.roots.length) return <Empty>The organisation chart is empty. Build it under Company › Organization; reporting lines there drive approvals automatically.</Empty>;
  return <div className="erp-card"><Tree nodes={d.roots} team={team} /></div>;
}

export default function ErpResourcesPage() {
  const { me } = useErpMe();
  const [tab, setTab] = useState('allocation'); const [team, setTeam] = useState([]);
  useEffect(() => { getTeam().then(r => setTeam(r.data.slice().sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {}); }, []);
  return (
    <div className="erp-page">
      <PageHead title="Resources" subtitle="Who approves whom, what each person costs per day, the holiday calendar, and the reporting tree." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'allocation', label: 'Allocation' }, ...(me?.canSeeMoney ? [{ id: 'rates', label: 'Rate card' }] : []), { id: 'holidays', label: 'Holidays' }, { id: 'hierarchy', label: 'Hierarchy' }]} />
      {tab === 'allocation' && <Allocation me={me} team={team} />}
      {tab === 'rates' && <RateCard me={me} team={team} />}
      {tab === 'holidays' && <Holidays me={me} />}
      {tab === 'hierarchy' && <Hierarchy team={team} />}
    </div>
  );
}
