import { useState } from 'react';
import './CalendarView.css';

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Month grid (Monday-first). Tasks sit on their due date; click a chip to open it.
export default function CalendarView({ tasks = [], statusColor = {}, onOpen }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [expanded, setExpanded] = useState({});

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });

  const byDay = {};
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const k = dayKey(new Date(t.dueDate));
    (byDay[k] ||= []).push(t);
  }
  const undated = tasks.filter(t => !t.dueDate).length;
  const todayKey = dayKey(today);
  const shift = (n) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));

  return (
    <div className="cal">
      <div className="cal-head">
        <span className="cal-title">{cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        <div className="cal-nav">
          {undated > 0 && <span className="cal-nodate">{undated} without a due date</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)} title="Previous month">‹</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
          <button className="btn btn-ghost btn-sm" onClick={() => shift(1)} title="Next month">›</button>
        </div>
      </div>

      <div className="cal-grid">
        {DOW.map(d => <div className="cal-dow" key={d}>{d}</div>)}
        {days.map(d => {
          const k = dayKey(d);
          const list = byDay[k] || [];
          const isOther = d.getMonth() !== cursor.getMonth();
          const open = expanded[k];
          const shown = open ? list : list.slice(0, 3);
          return (
            <div className={`cal-day ${isOther ? 'other' : ''} ${k === todayKey ? 'today' : ''}`} key={k}>
              <span className="cal-num">{d.getDate()}</span>
              {shown.map(t => (
                <button className="cal-chip" key={t.id} onClick={() => onOpen?.(t)} title={t.title}>
                  <span className="dot" style={{ background: statusColor[t.status] || 'var(--text-muted)' }} />
                  <span className="t">{t.title}</span>
                </button>
              ))}
              {list.length > 3 && (
                <button className="cal-more" onClick={() => setExpanded(p => ({ ...p, [k]: !open }))}>
                  {open ? 'Show less' : `+${list.length - 3} more`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
