import { useState } from 'react';
import Avatar from './Avatar';
import './TimelineView.css';

const DAY = 36;   // px per day
const DAYS = 42;  // 6 weeks visible
const MS_DAY = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// Gantt-style timeline: one row per task, a bar from its start (startDate, else
// the day it was created) to its due date. Tasks without a due date get a
// dashed one-day bar so they still appear.
export default function TimelineView({ tasks = [], teamMembers = [], statusColor = {}, onOpen }) {
  const [start, setStart] = useState(() => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); // last week's Monday
    return d;
  });
  const days = Array.from({ length: DAYS }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const idx = (d) => Math.floor((startOfDay(d) - start) / MS_DAY);
  const todayIdx = idx(new Date());

  const rows = tasks
    .map(t => {
      const s = startOfDay(t.startDate || t.createdDate || Date.now());
      const noDue = !t.dueDate;
      let e = noDue ? new Date(s) : startOfDay(t.dueDate);
      if (e < s) e = new Date(s);
      return { t, si: idx(s), ei: idx(e), noDue };
    })
    .filter(r => r.ei >= 0 && r.si < DAYS)
    .sort((a, b) => a.si - b.si || a.ei - b.ei);

  // Month labels across the header
  const months = [];
  days.forEach((d, i) => {
    const last = months[months.length - 1];
    if (last && last.m === d.getMonth()) last.n += 1;
    else months.push({ m: d.getMonth(), label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), n: 1, i });
  });

  const shift = (n) => setStart(prev => { const d = new Date(prev); d.setDate(d.getDate() + n); return d; });
  const trackStyle = { width: DAYS * DAY, backgroundSize: `${DAY}px 100%` };

  return (
    <div className="tl">
      <div className="tl-toolbar">
        <span className="tl-title">{days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {days[DAYS - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <div className="cal-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => shift(-14)}>‹ 2 weeks</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); setStart(d); }}>Today</button>
          <button className="btn btn-ghost btn-sm" onClick={() => shift(14)}>2 weeks ›</button>
        </div>
      </div>

      <div className="tl-scroll">
        {/* Header: months + day numbers */}
        <div className="tl-row tl-head">
          <div className="tl-left">Task</div>
          <div style={{ width: DAYS * DAY }}>
            <div className="tl-months">
              {months.map(m => <div className="tl-month" key={m.label} style={{ width: m.n * DAY }}>{m.label}</div>)}
            </div>
            <div className="tl-days">
              {days.map((d, i) => (
                <div className={`tl-dayc ${d.getDay() === 0 || d.getDay() === 6 ? 'we' : ''} ${i === todayIdx ? 'today' : ''}`} key={i} style={{ width: DAY }}>{d.getDate()}</div>
              ))}
            </div>
          </div>
        </div>

        {rows.length === 0 && <div className="tl-empty">No tasks scheduled in this window.</div>}

        {rows.map(({ t, si, ei, noDue }) => {
          const from = Math.max(si, 0);
          const to = Math.min(ei, DAYS - 1);
          const width = (to - from + 1) * DAY - 4;
          const color = statusColor[t.status] || 'var(--text-muted)';
          return (
            <div className="tl-row" key={t.id}>
              <div className="tl-left" onClick={() => onOpen?.(t)} style={{ cursor: 'pointer' }}>
                <span className="dot" style={{ background: color }} />
                <span className="t" title={t.title}>{t.title}</span>
                {t.assignee && <Avatar name={t.assignee} members={teamMembers} size={20} />}
              </div>
              <div className="tl-track" style={trackStyle}>
                {todayIdx >= 0 && todayIdx < DAYS && <div className="tl-today" style={{ left: todayIdx * DAY + DAY / 2 }} />}
                <div className={`tl-bar ${noDue ? 'nodue' : ''}`} style={{ left: from * DAY + 2, width, background: color, color: noDue ? color : '#fff' }}
                  onClick={() => onOpen?.(t)} title={`${t.title}${noDue ? ' (no due date)' : ''}`}>
                  {width > 70 ? t.title : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
