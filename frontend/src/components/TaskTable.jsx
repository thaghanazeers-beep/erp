import { useState, useEffect, useRef, useMemo } from 'react';
import './TaskTable.css';

/**
 * Notion-style task table: per-column header menus (sort / filter / hide),
 * a Columns popover, and collapsible grouping (Assignee, Status, Project,
 * Priority, Sprint). Preferences persist per-browser in localStorage.
 */

const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

const COLUMNS = [
  { key: 'title',          label: 'Task name',   always: true,        width: 280 },
  { key: 'project',        label: 'Project',     filterKey: 'project' },
  { key: 'priority',       label: 'Priority',    filterKey: 'priority' },
  { key: 'status',         label: 'Status',      filterKey: 'status' },
  { key: 'sprint',         label: 'Sprint',      filterKey: 'sprint' },
  { key: 'assignee',       label: 'Assignee',    filterKey: 'assignee' },
  { key: 'dueDate',        label: 'Due date' },
  { key: 'estimatedHours', label: 'Est. hours' },
  { key: 'actualHours',    label: 'Actual hours' },
  { key: 'createdDate',    label: 'Created' },
];

const GROUP_OPTIONS = [
  { key: '',         label: 'No grouping' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'status',   label: 'Status' },
  { key: 'project',  label: 'Project' },
  { key: 'priority', label: 'Priority' },
  { key: 'sprint',   label: 'Sprint' },
];

export default function TaskTable({
  tasks, projects, sprints, teamMembers,
  statuses, priorities, priorityColor,
  canEditTask, canChangeStatusTo,
  onStatusChange, onInlineUpdate, onDelete, onOpen,
  onFilter, // (filterKey, value) -> applies a page-level filter
  formatDate, renderAvatar,
  // View config (controlled by the parent — shared Notion-style view)
  sorts = [], groupBy = '', hidden = [],
  columnOrder = [], columnWidths = null, calcs = null,
  onPrefsChange, // ({ sorts? | groupBy? | hiddenColumns? | columnOrder? | columnWidths? | calcs? })
}) {
  // Collapsed groups are personal (not part of the shared view)
  const [collapsed, setCollapsed] = useState({});
  const [menuCol, setMenuCol] = useState(null);   // column key with open header menu
  const [menuFilterOpen, setMenuFilterOpen] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [calcCol, setCalcCol] = useState(null);   // column key with open Calculate menu
  const [dragKey, setDragKey] = useState(null);   // column being dragged
  const [overKey, setOverKey] = useState(null);   // drop target column
  const [localWidths, setLocalWidths] = useState({}); // live widths while resizing
  const rootRef = useRef(null);
  const resizeRef = useRef(null);

  const setSorts = (updater) =>
    onPrefsChange({ sorts: typeof updater === 'function' ? updater(sorts) : updater });
  const setGroupBy = (v) => onPrefsChange({ groupBy: v });
  const setHidden = (v) => onPrefsChange({ hiddenColumns: v });

  // Close any open popover on outside click
  useEffect(() => {
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setMenuCol(null); setMenuFilterOpen(false); setShowColumns(false); setShowSort(false); setCalcCol(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const projectName = (id) => {
    const p = projects.find(pr => pr._id === id);
    return p ? `${p.icon || ''} ${p.name}`.trim() : '';
  };
  const sprintName = (id) => sprints.find(s => s._id === id)?.name || '';

  const cellValue = (t, key) => {
    switch (key) {
      case 'project': return projectName(t.projectId);
      case 'sprint': return sprintName(t.sprintId);
      case 'assignee': return t.assignee || '';
      case 'priority': return t.priority || '';
      case 'status': return t.status || '';
      case 'dueDate': return t.dueDate ? new Date(t.dueDate).getTime() : Infinity;
      case 'createdDate': return t.createdDate ? new Date(t.createdDate).getTime() : Infinity;
      case 'estimatedHours': return t.estimatedHours || 0;
      case 'actualHours': return t.actualHours || 0;
      default: return (t.title || '').toLowerCase();
    }
  };

  const compareBy = (a, b, rule) => {
    if (rule.key === 'priority') {
      return ((PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)) * rule.dir;
    }
    const av = cellValue(a, rule.key);
    const bv = cellValue(b, rule.key);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * rule.dir;
    return String(av).localeCompare(String(bv)) * rule.dir;
  };

  const sorted = useMemo(() => {
    if (!sorts.length) return tasks;
    const arr = [...tasks];
    arr.sort((a, b) => {
      for (const rule of sorts) {
        const c = compareBy(a, b, rule);
        if (c !== 0) return c;
      }
      return 0;
    });
    return arr;
  }, [tasks, sorts, projects, sprints]);

  const groupKeyOf = (t) => {
    switch (groupBy) {
      case 'assignee': return t.assignee || 'No assignee';
      case 'status': return t.status || 'No status';
      case 'project': return projectName(t.projectId) || 'No project';
      case 'priority': return t.priority || 'No priority';
      case 'sprint': return sprintName(t.sprintId) || 'No sprint';
      default: return '';
    }
  };

  const groups = useMemo(() => {
    if (!groupBy) return [{ name: null, rows: sorted }];
    const map = new Map();
    for (const t of sorted) {
      const g = groupKeyOf(t);
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(t);
    }
    return [...map.entries()].map(([name, rows]) => ({ name, rows }));
  }, [sorted, groupBy, projects, sprints]);

  // Column order: view-defined, unknown/new columns appended; title stays first
  const orderedCols = useMemo(() => {
    const byKey = Object.fromEntries(COLUMNS.map(c => [c.key, c]));
    const ordered = (columnOrder || []).filter(k => byKey[k]).map(k => byKey[k]);
    const rest = COLUMNS.filter(c => !ordered.includes(c));
    const all = [...ordered, ...rest];
    return [all.find(c => c.key === 'title'), ...all.filter(c => c.key !== 'title')];
  }, [columnOrder]);
  const visibleCols = orderedCols.filter(c => c.always || !hidden.includes(c.key));

  const moveColumn = (fromKey, toKey) => {
    if (!fromKey || fromKey === toKey || toKey === 'title') return;
    const keys = orderedCols.map(c => c.key);
    const from = keys.indexOf(fromKey);
    const to = keys.indexOf(toKey);
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    onPrefsChange({ columnOrder: keys });
  };

  // Column resize — live-local while dragging, persisted to the view on release
  const widths = { ...(columnWidths || {}), ...localWidths };
  const liveWidths = useRef({});
  const startResize = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.target.closest('th');
    resizeRef.current = { key, startX: e.clientX, startW: th.offsetWidth };
    const move = (ev) => {
      if (!resizeRef.current) return;
      const { key: k, startX, startW } = resizeRef.current;
      const next = { ...liveWidths.current, [k]: Math.max(80, startW + ev.clientX - startX) };
      liveWidths.current = next;
      setLocalWidths(next);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      onPrefsChange({ columnWidths: { ...(columnWidths || {}), ...liveWidths.current } });
      resizeRef.current = null;
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  // Footer "Calculate" (Notion-style aggregates over the filtered rows)
  const NUMERIC_COLS = ['estimatedHours', 'actualHours'];
  const CALC_OPTIONS_BASE = [['', 'None'], ['count', 'Count all'], ['count_empty', 'Count empty'], ['count_not_empty', 'Count not empty']];
  const CALC_OPTIONS_NUM = [...CALC_OPTIONS_BASE, ['sum', 'Sum'], ['avg', 'Average']];
  const isEmptyCell = (t, key) => {
    switch (key) {
      case 'project': return !t.projectId;
      case 'sprint': return !t.sprintId;
      case 'assignee': return !t.assignee;
      case 'priority': return !t.priority;
      case 'status': return !t.status;
      case 'dueDate': return !t.dueDate;
      case 'createdDate': return !t.createdDate;
      case 'estimatedHours': return !(t.estimatedHours > 0);
      case 'actualHours': return !(t.actualHours > 0);
      default: return !t.title;
    }
  };
  const calcDisplay = (key) => {
    const op = calcs?.[key];
    if (!op) return null;
    const rows = sorted;
    if (op === 'count') return `Count ${rows.length}`;
    if (op === 'count_empty') return `Empty ${rows.filter(t => isEmptyCell(t, key)).length}`;
    if (op === 'count_not_empty') return `Not empty ${rows.filter(t => !isEmptyCell(t, key)).length}`;
    const sum = rows.reduce((acc, t) => acc + (Number(t[key]) || 0), 0);
    if (op === 'sum') return `Sum ${Math.round(sum * 10) / 10}h`;
    if (op === 'avg') return `Avg ${rows.length ? Math.round((sum / rows.length) * 10) / 10 : 0}h`;
    return null;
  };
  const setCalc = (key, op) => {
    const next = { ...(calcs || {}) };
    if (op) next[key] = op; else delete next[key];
    onPrefsChange({ calcs: next });
    setCalcCol(null);
  };

  const distinctFilterValues = (col) => {
    switch (col.filterKey) {
      case 'assignee': return [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort().map(v => ({ value: v, label: v }));
      case 'status': return statuses.map(s => ({ value: s, label: s }));
      case 'priority': return priorities.map(p => ({ value: p, label: p }));
      case 'project': return projects.map(p => ({ value: p._id, label: p.name }));
      case 'sprint': return sprints.map(s => ({ value: s._id, label: s.name }));
      default: return [];
    }
  };

  // Header menu sort: sets/updates this column as the FIRST sort rule
  const toggleSort = (key, dir) => {
    setSorts(prev => {
      const existing = prev.find(s => s.key === key);
      if (existing && existing.dir === dir && prev[0]?.key === key) return prev.filter(s => s.key !== key);
      return [{ key, dir }, ...prev.filter(s => s.key !== key)];
    });
    setMenuCol(null); setMenuFilterOpen(false);
  };
  const updateSortRule = (i, patch) => setSorts(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const removeSortRule = (i) => setSorts(prev => prev.filter((_, idx) => idx !== i));
  const addSortRule = () => {
    const used = new Set(sorts.map(s => s.key));
    const next = COLUMNS.find(c => !used.has(c.key));
    if (next) setSorts(prev => [...prev, { key: next.key, dir: 1 }]);
  };
  const hideColumn = (key) => {
    setHidden([...new Set([...hidden, key])]);
    setMenuCol(null); setMenuFilterOpen(false);
  };
  const toggleColumn = (key) => {
    setHidden(hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key]);
  };
  const toggleGroup = (name) => setCollapsed({ ...collapsed, [name]: !collapsed[name] });

  const renderCell = (task, col) => {
    const editable = canEditTask(task);
    switch (col.key) {
      case 'title':
        return <span className="tt-title" onClick={() => onOpen(task)}>{task.title}</span>;
      case 'project':
        return <span className="tt-muted">{projectName(task.projectId) || '—'}</span>;
      case 'sprint':
        return <span className="tt-muted">{sprintName(task.sprintId) || '—'}</span>;
      case 'priority':
        return editable ? (
          <select
            className="tt-select"
            value={task.priority || ''}
            style={task.priority ? { color: priorityColor[task.priority] } : {}}
            onChange={(e) => onInlineUpdate(task.id, { priority: e.target.value })}
          >
            <option value="">None</option>
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          task.priority
            ? <span className="task-priority-badge" style={{ background: priorityColor[task.priority] + '14', color: priorityColor[task.priority] }}>{task.priority}</span>
            : <span className="tt-muted">—</span>
        );
      case 'status':
        return (
          <select className="tt-select" value={task.status} disabled={!editable} onChange={(e) => onStatusChange(task.id, e.target.value)}>
            {statuses.map(s => <option key={s} value={s} disabled={!canChangeStatusTo(task, s)}>{s}</option>)}
          </select>
        );
      case 'assignee':
        return editable ? (
          <select className="tt-select" value={task.assignee || ''} onChange={(e) => onInlineUpdate(task.id, { assignee: e.target.value })}>
            <option value="">Unassigned</option>
            {teamMembers.map(m => <option key={m._id} value={m.name}>{m.name}</option>)}
          </select>
        ) : (
          <span className="tt-muted">{task.assignee || '—'}</span>
        );
      case 'dueDate':
        return <span className="tt-muted">{formatDate(task.dueDate) || '—'}</span>;
      case 'createdDate':
        return <span className="tt-muted">{formatDate(task.createdDate) || '—'}</span>;
      case 'estimatedHours':
        return <span className="tt-muted">{task.estimatedHours || 0}h</span>;
      case 'actualHours':
        return <span className="tt-muted">{task.actualHours || 0}h</span>;
      default:
        return null;
    }
  };

  return (
    <div className="tt-root" ref={rootRef}>
      {/* Toolbar: grouping + column visibility */}
      <div className="tt-toolbar">
        <div className="tt-toolbar-left">
          <label className="tt-toolbar-label">Group by</label>
          <select className="tt-select tt-group-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {GROUP_OPTIONS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </div>
        <div className="tt-toolbar-right">
          <div className="tt-columns-wrap">
            <button className={`btn btn-ghost btn-sm ${sorts.length ? 'active-filter' : ''}`} onClick={() => { setShowSort(!showSort); setShowColumns(false); setMenuCol(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5h10M11 9h7M11 13h4"/><path d="M3 17l3 3 3-3M6 18V4"/></svg>
              Sort{sorts.length ? ` · ${sorts.length}` : ''}
            </button>
            {showSort && (
              <div className="tt-popover tt-sort-popover">
                <div className="tt-popover-title">Sort by</div>
                {sorts.length === 0 && <p className="tt-popover-empty">No sorts applied.</p>}
                {sorts.map((s, i) => (
                  <div className="tt-sort-row" key={`${s.key}-${i}`}>
                    <span className="tt-sort-then">{i === 0 ? 'Sort by' : 'then by'}</span>
                    <select className="fr-select" value={s.key} onChange={(e) => updateSortRule(i, { key: e.target.value })}>
                      {COLUMNS.filter(c => c.key === s.key || !sorts.some(x => x.key === c.key)).map(c => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                    <select className="fr-select" value={s.dir} onChange={(e) => updateSortRule(i, { dir: Number(e.target.value) })}>
                      <option value={1}>Ascending</option>
                      <option value={-1}>Descending</option>
                    </select>
                    <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={() => removeSortRule(i)} title="Remove sort">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
                <button className="fr-add" style={{ margin: '4px 8px 4px' }} onClick={addSortRule}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add sort
                </button>
              </div>
            )}
          </div>

          <div className="tt-columns-wrap">
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowColumns(!showColumns); setShowSort(false); setMenuCol(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              Columns
            </button>
            {showColumns && (
              <div className="tt-popover tt-columns-popover">
                <div className="tt-popover-title">Shown in table</div>
                {COLUMNS.filter(c => !c.always).map(c => (
                  <label key={c.key} className="tt-popover-row">
                    <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="table-wrapper tt-table-wrap">
        <table className="task-table tt-table">
          <thead>
            <tr>
              {visibleCols.map(col => {
                const sortRule = sorts.find(s => s.key === col.key);
                const w = widths[col.key];
                return (
                <th
                  key={col.key}
                  className={overKey === col.key && dragKey && dragKey !== col.key ? 'tt-th-dropover' : ''}
                  style={{
                    ...(w ? { width: w, minWidth: w, maxWidth: w } : (col.width ? { minWidth: col.width } : {})),
                  }}
                  draggable={col.key !== 'title'}
                  onDragStart={(e) => { setDragKey(col.key); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { e.preventDefault(); if (dragKey) setOverKey(col.key); }}
                  onDragLeave={() => setOverKey(k => (k === col.key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); moveColumn(dragKey, col.key); setDragKey(null); setOverKey(null); }}
                  onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                >
                  <button
                    className={`tt-th ${menuCol === col.key ? 'tt-th-open' : ''} ${sortRule ? 'tt-th-sorted' : ''}`}
                    onClick={() => { setMenuCol(menuCol === col.key ? null : col.key); setMenuFilterOpen(false); setShowColumns(false); setShowSort(false); }}
                  >
                    {col.label}
                    {sortRule && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: sortRule.dir === -1 ? 'rotate(180deg)' : 'none' }}><polyline points="6 9 12 15 18 9"/></svg>
                    )}
                  </button>
                  <span className="tt-resize" onMouseDown={(e) => startResize(e, col.key)} />

                  {menuCol === col.key && (
                    <div className="tt-popover tt-th-menu">
                      <button className="tt-menu-item" onClick={() => toggleSort(col.key, 1)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                        Sort ascending
                      </button>
                      <button className="tt-menu-item" onClick={() => toggleSort(col.key, -1)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                        Sort descending
                      </button>
                      {col.filterKey && (
                        <>
                          <div className="tt-menu-sep" />
                          <button className="tt-menu-item" onClick={() => setMenuFilterOpen(!menuFilterOpen)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                            Filter by {col.label.toLowerCase()}
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 'auto' }}><polyline points="9 18 15 12 9 6"/></svg>
                          </button>
                          {menuFilterOpen && (
                            <div className="tt-filter-values">
                              {distinctFilterValues(col).map(v => (
                                <button key={v.value} className="tt-menu-item" onClick={() => { onFilter(col.filterKey, v.value); setMenuCol(null); setMenuFilterOpen(false); }}>
                                  {v.label}
                                </button>
                              ))}
                              <button className="tt-menu-item tt-menu-clear" onClick={() => { onFilter(col.filterKey, ''); setMenuCol(null); setMenuFilterOpen(false); }}>
                                Clear filter
                              </button>
                            </div>
                          )}
                        </>
                      )}
                      {!col.always && (
                        <>
                          <div className="tt-menu-sep" />
                          <button className="tt-menu-item" onClick={() => hideColumn(col.key)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            Hide column
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </th>
                );
              })}
              <th style={{ width: 40 }} />
            </tr>
          </thead>

          {groups.map(group => (
            <tbody key={group.name ?? '__all__'}>
              {group.name !== null && (
                <tr className="tt-group-row" onClick={() => toggleGroup(group.name)}>
                  <td colSpan={visibleCols.length + 1}>
                    <span className="tt-group-head">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: collapsed[group.name] ? 'none' : 'rotate(90deg)', transition: 'transform 0.12s' }}><polyline points="9 6 15 12 9 18"/></svg>
                      {groupBy === 'assignee' && group.name !== 'No assignee' && (
                        <span className="tt-group-avatar">{renderAvatar(group.name)}</span>
                      )}
                      <span className="tt-group-name">{group.name}</span>
                      <span className="tt-group-count">{group.rows.length}</span>
                    </span>
                  </td>
                </tr>
              )}
              {!collapsed[group.name] && group.rows.map(task => (
                <tr key={task.id}>
                  {visibleCols.map(col => <td key={col.key}>{renderCell(task, col)}</td>)}
                  <td className="tt-row-actions">
                    {canEditTask(task) && (
                      <button className="btn-icon" style={{ width: 26, height: 26 }} onClick={() => onDelete(task.id)} title="Delete">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}

          {/* Calculate row (Notion-style aggregates over the filtered rows) */}
          {tasks.length > 0 && (
            <tfoot>
              <tr className="tt-calc-row">
                {visibleCols.map(col => (
                  <td key={col.key}>
                    <button
                      className={`tt-calc-btn ${calcs?.[col.key] ? 'tt-calc-set' : ''}`}
                      onClick={() => { setCalcCol(calcCol === col.key ? null : col.key); setMenuCol(null); }}
                    >
                      {calcDisplay(col.key) || (
                        <span className="tt-calc-hint">
                          Calculate
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                        </span>
                      )}
                    </button>
                    {calcCol === col.key && (
                      <div className="tt-popover tt-calc-menu">
                        {(NUMERIC_COLS.includes(col.key) ? CALC_OPTIONS_NUM : CALC_OPTIONS_BASE).map(([op, label]) => (
                          <button
                            key={op || 'none'}
                            className={`tt-menu-item ${(calcs?.[col.key] || '') === op ? 'tt-menu-item-active' : ''}`}
                            onClick={() => setCalc(col.key, op)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        {tasks.length === 0 && <div className="empty-state" style={{ marginTop: 32 }}><p>No tasks match.</p></div>}
      </div>
    </div>
  );
}
