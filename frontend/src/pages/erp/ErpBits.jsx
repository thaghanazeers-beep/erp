import { useEffect, useState } from 'react';
import { erpSummary } from '../../api';
import { erpJump, STATUS_LABEL } from './erpUtils';
import './erp.css';

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="erp-head">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {children && <div className="erp-head-actions">{children}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="erp-tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`erp-tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}{t.count != null && <span className="cnt">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatusChip({ status }) {
  return <span className={`erp-status ${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export function Banner({ kind = 'info', children, onClose }) {
  if (!children) return null;
  return <div className={`ts-banner ${kind}`}>{children}{onClose && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Dismiss</button>}</div>;
}

export function Empty({ children }) { return <div className="erp-empty">{children}</div>; }

export function Modal({ title, onClose, children, width }) {
  return (
    <div className="erp-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="erp-modal" style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function WeekPicker({ year, week, weeks, onChange }) {
  const years = [year - 1, year, year + 1];
  return (
    <>
      <label className="erp-field"><span>Year</span>
        <select className="input" value={year} onChange={(e) => onChange(Number(e.target.value), 1)}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
      </label>
      <label className="erp-field grow"><span>Week</span>
        <select className="input" value={week} onChange={(e) => onChange(year, Number(e.target.value))}>{weeks.map(w => <option key={w.n} value={w.n}>{w.label}</option>)}</select>
      </label>
      <div className="erp-field"><span>&nbsp;</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { if (week > 1) onChange(year, week - 1); else onChange(year - 1, 53); }} title="Previous week">‹</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { if (week < weeks.length) onChange(year, week + 1); else onChange(year + 1, 1); }} title="Next week">›</button>
        </div>
      </div>
    </>
  );
}

function Ring({ pct, color }) {
  return (
    <div className="ring" style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, var(--bg-hover) 0)` }}><i>{pct}%</i></div>
  );
}

/**
 * The legacy ERP's compliance bar: my missing weeks, approvals waiting on me,
 * team members who have not submitted. Each week is a jump to the right screen.
 */
export function ComplianceStrip({ compact = false }) {
  const [s, setS] = useState(null);
  useEffect(() => { let on = true; erpSummary().then(r => { if (on) setS(r.data); }).catch(() => {}); return () => { on = false; }; }, []);
  if (!s) return null;
  const col = (p) => (p >= 90 ? 'var(--accent-green)' : p >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)');
  const weekBtns = (list, page) => list.slice(0, compact ? 4 : 8).map(w => <button key={`${w.year}-${w.week}`} onClick={() => erpJump(page, { year: w.year, week: w.week })} title={w.label}>Wk {w.week}</button>);
  return (
    <div className="erp-strip">
      <div className="erp-gauge"><Ring pct={s.gauges.mine} color={col(s.gauges.mine)} /><div><b>My timesheets</b><small>{s.myMissing.length ? `${s.myMissing.length} of the last 8 weeks not submitted` : 'Last 8 weeks submitted'}</small><div className="weeks">{weekBtns(s.myMissing, 'timesheet')}</div></div></div>
      {s.isManager && <div className="erp-gauge"><Ring pct={s.gauges.approvals} color={col(s.gauges.approvals)} /><div><b>Approvals waiting</b><small>{s.approvalPending.length ? `${s.approvalPending.reduce((a, w) => a + w.users.length, 0)} sheets across ${s.approvalPending.length} weeks` : 'Nothing waiting for you'}</small><div className="weeks">{weekBtns(s.approvalPending, 'approvals')}</div></div></div>}
      {s.isManager && <div className="erp-gauge"><Ring pct={s.gauges.team} color={col(s.gauges.team)} /><div><b>Team timesheets</b><small>{s.teamPending.length ? `Missing in ${s.teamPending.length} of the last 8 weeks` : 'Everyone is up to date'}</small><div className="weeks">{weekBtns(s.teamPending, 'erp-team')}</div></div></div>}
    </div>
  );
}
