import { useState, useEffect, useRef, useMemo } from 'react';
import Avatar from './Avatar';
import { tagColor } from './taskUtils';
import './TaskTable.css';

const STATUS_DOT = {
  'Not Yet Started': 'dot-notstarted', 'In Progress': 'dot-progress', 'In Review': 'dot-review', 'Completed': 'dot-done', 'Rejected': 'dot-rejected',
};
const STATUS_BADGE = {
  'Not Yet Started': 'badge-notstarted', 'In Progress': 'badge-progress', 'In Review': 'badge-review', 'Completed': 'badge-done', 'Rejected': 'badge-rejected',
};

/**
 * Notion-style task table: per-column header menus (sort / filter / hide),
 * a Columns popover, and collapsible grouping (Assignee, Status, Project,
 * Priority, Sprint). Preferences persist per-browser in localStorage.
 */

const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

const COLUMNS = [
  { key: 'title',          label: 'Task name',   always: true,        width: 300 },
  { key: 'status',         label: 'Status',      filterKey: 'status' },
  { key: 'priority',       label: 'Priority',    filterKey: 'priority' },
  { key: 'assignee',       label: 'Assignee',    filterKey: 'assignee' },
  { key: 'tags',           label: 'Tags' },
  { key: 'dueDate',        label: 'Due date' },
  { key: 'progress',       label: 'Progress' },
  { key: 'project',        label: 'Project',     filterKey: 'project' },
  { key: 'sprint',         label: 'Sprint',      filterKey: 'sprint' },
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

const PROPERTY_TYPES = [
  ['text', 'Text'], ['number', 'Number'], ['select', 'Select'], ['multiSelect', 'Multi-select'],
  ['date', 'Date'], ['checkbox', 'Checkbox'], ['url', 'URL'], ['email', 'Email'], ['phone', 'Phone'],
];

/** "+ New property" form inside the Columns popover */
function NewPropertyForm({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');

  if (!open) {
    return (
      <button className="fr-add" style={{ margin: '4px 6px 2px' }} onClick={() => setOpen(true)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New property
      </button>
    );
  }
  const needsOptions = type === 'select' || type === 'multiSelect';
  const submit = () => {
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      type,
      options: needsOptions ? options.split(',').map(s => s.trim()).filter(Boolean) : [],
    });
    setName(''); setType('text'); setOptions(''); setOpen(false);
  };
  return (
    <div className="tt-newprop">
      <input className="fr-select" placeholder="Property name" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <select className="fr-select" value={type} onChange={(e) => setType(e.target.value)}>
        {PROPERTY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {needsOptions && (
        <input className="fr-select" placeholder="Options (comma separated)" value={options} onChange={(e) => setOptions(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      )}
      <div className="tt-newprop-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={!name.trim()}>Add</button>
      </div>
    </div>
  );
}

export default function TaskTable({
  tasks, projects, sprints, teamMembers,
  statuses, priorities, priorityColor,
  canEditTask, canChangeStatusTo,
  onStatusChange, onInlineUpdate, onDelete, onOpen,
  onFilter, // (filterKey, value) -> applies a page-level filter
  formatDate,
  taskProgress = () => 0, // (task) -> 0..100; subtask-aware when the parent provides it
  // View config (controlled by the parent — shared Notion-style view)
  sorts = [], groupBy = '', hidden = [],
  columnOrder = [], columnWidths = null, calcs = null,
  onPrefsChange, // ({ sorts? | groupBy? | hiddenColumns? | columnOrder? | columnWidths? | calcs? })
  // Custom database properties (Notion-style)
  customProps = [], onCreateProperty, onDeleteProperty,
  // Inline row creation + selection
  onCreateTask,                     // async ({ title, ...groupPreset })
  selectedIds = [], onToggleSelect, onToggleSelectAll,
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
  const [newRowGroup, setNewRowGroup] = useState(null); // group name (or '__ALL__') with an open "+ New" input
  const rootRef = useRef(null);
  const resizeRef = useRef(null);

  // Values a new row inherits from its group section (Notion behavior)
  const groupPreset = (group) => {
    if (!groupBy || group.name === null || !group.rows.length) return {};
    const t = group.rows[0];
    switch (groupBy) {
      case 'assignee': return { assignee: t.assignee || '' };
      case 'status': return { status: t.status };
      case 'project': return { projectId: t.projectId || null };
      case 'priority': return { priority: t.priority || '' };
      case 'sprint': return { sprintId: t.sprintId || null };
      default: return {};
    }
  };

  const commitNewRow = async (e, group) => {
    const title = e.target.value.trim();
    setNewRowGroup(null);
    if (!title || !onCreateTask) return;
    await onCreateTask({ title, ...groupPreset(group) });
  };

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

  const cpDef = (key) => customProps.find(d => `cp_${d.id}` === key);
  const cpRaw = (t, key) => t.customProperties?.find(p => `cp_${p.definitionId}` === key)?.value;

  const cellValue = (t, key) => {
    if (key.startsWith('cp_')) {
      const def = cpDef(key);
      const raw = cpRaw(t, key);
      switch (def?.type) {
        case 'number': return raw == null || raw === '' ? -Infinity : Number(raw);
        case 'date': return raw ? new Date(raw).getTime() : Infinity;
        case 'checkbox': return raw === true ? 0 : 1;
        case 'multiSelect': return (Array.isArray(raw) ? raw.join(', ') : '').toLowerCase();
        default: return String(raw ?? '').toLowerCase();
      }
    }
    switch (key) {
      case 'project': return projectName(t.projectId);
      case 'sprint': return sprintName(t.sprintId);
      case 'assignee': return t.assignee || '';
      case 'priority': return t.priority || '';
      case 'status': return t.status || '';
      case 'tags': return (t.taskType?.[0] || '').toLowerCase();
      case 'progress': return taskProgress(t);
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

  // Built-in columns + one column per custom property definition
  const allColumns = useMemo(() => [
    ...COLUMNS,
    ...customProps.map(d => ({
      key: `cp_${d.id}`,
      label: d.name,
      cp: d,
      filterKey: ['select', 'multiSelect'].includes(d.type) ? `cp_${d.id}` : undefined,
    })),
  ], [customProps]);

  // Column order: view-defined, unknown/new columns appended; title stays first
  const orderedCols = useMemo(() => {
    const byKey = Object.fromEntries(allColumns.map(c => [c.key, c]));
    const ordered = (columnOrder || []).filter(k => byKey[k]).map(k => byKey[k]);
    const rest = allColumns.filter(c => !ordered.includes(c));
    const all = [...ordered, ...rest];
    return [all.find(c => c.key === 'title'), ...all.filter(c => c.key !== 'title')];
  }, [columnOrder, allColumns]);
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
  const isNumericCol = (key) => ['estimatedHours', 'actualHours', 'progress'].includes(key) || cpDef(key)?.type === 'number';
  const numericValue = (t, key) => key === 'progress' ? taskProgress(t) : key.startsWith('cp_') ? (Number(cpRaw(t, key)) || 0) : (Number(t[key]) || 0);
  const CALC_OPTIONS_BASE = [['', 'None'], ['count', 'Count all'], ['count_empty', 'Count empty'], ['count_not_empty', 'Count not empty']];
  const CALC_OPTIONS_NUM = [...CALC_OPTIONS_BASE, ['sum', 'Sum'], ['avg', 'Average']];
  const isEmptyCell = (t, key) => {
    if (key.startsWith('cp_')) {
      const raw = cpRaw(t, key);
      return raw == null || raw === '' || raw === false || (Array.isArray(raw) && raw.length === 0);
    }
    switch (key) {
      case 'project': return !t.projectId;
      case 'sprint': return !t.sprintId;
      case 'assignee': return !t.assignee;
      case 'priority': return !t.priority;
      case 'status': return !t.status;
      case 'tags': return !(t.taskType?.length);
      case 'progress': return false;
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
    const unit = key === 'progress' ? '%' : key.startsWith('cp_') ? '' : 'h';
    if (op === 'count') return `Count ${rows.length}`;
    if (op === 'count_empty') return `Empty ${rows.filter(t => isEmptyCell(t, key)).length}`;
    if (op === 'count_not_empty') return `Not empty ${rows.filter(t => !isEmptyCell(t, key)).length}`;
    const sum = rows.reduce((acc, t) => acc + numericValue(t, key), 0);
    if (op === 'sum') return `Sum ${Math.round(sum * 10) / 10}${unit}`;
    if (op === 'avg') return `Avg ${rows.length ? Math.round((sum / rows.length) * 10) / 10 : 0}${unit}`;
    return null;
  };
  const setCalc = (key, op) => {
    const next = { ...(calcs || {}) };
    if (op) next[key] = op; else delete next[key];
    onPrefsChange({ calcs: next });
    setCalcCol(null);
  };

  const distinctFilterValues = (col) => {
    if (col.cp) return (col.cp.options || []).map(o => ({ value: o, label: o }));
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
    const next = allColumns.find(c => !used.has(c.key));
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

  // Write a custom-property value back onto the task
  const setCpValue = (task, defId, value) => {
    const rest = (task.customProperties || []).filter(p => p.definitionId !== defId);
    const cleared = value == null || value === '' || (Array.isArray(value) && value.length === 0);
    onInlineUpdate(task.id, { customProperties: cleared ? rest : [...rest, { definitionId: defId, value }] });
  };

  const renderCpCell = (task, def, editable) => {
    const raw = cpRaw(task, `cp_${def.id}`);
    if (!editable) {
      if (def.type === 'checkbox') return <input type="checkbox" checked={raw === true} disabled />;
      if (def.type === 'multiSelect') return <span className="tt-muted">{Array.isArray(raw) && raw.length ? raw.join(', ') : '—'}</span>;
      return <span className="tt-muted">{raw ?? '—'}</span>;
    }
    switch (def.type) {
      case 'checkbox':
        return <input type="checkbox" className="tt-cp-check" checked={raw === true} onChange={(e) => setCpValue(task, def.id, e.target.checked)} />;
      case 'select':
        return (
          <select className="tt-select" value={raw || ''} onChange={(e) => setCpValue(task, def.id, e.target.value)}>
            <option value="">—</option>
            {(def.options || []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      case 'multiSelect':
        return (
          <select
            className="tt-select"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const cur = Array.isArray(raw) ? raw : [];
              setCpValue(task, def.id, cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]);
            }}
          >
            <option value="">{Array.isArray(raw) && raw.length ? raw.join(', ') : '—'}</option>
            {(def.options || []).map(o => (
              <option key={o} value={o}>{Array.isArray(raw) && raw.includes(o) ? `✓ ${o}` : o}</option>
            ))}
          </select>
        );
      case 'date':
        return <input type="date" className="tt-cell-input" value={raw ? String(raw).slice(0, 10) : ''} onChange={(e) => setCpValue(task, def.id, e.target.value)} />;
      case 'number':
        return (
          <input
            type="number"
            className="tt-cell-input"
            key={`${task.id}_${raw ?? ''}`}
            defaultValue={raw ?? ''}
            onBlur={(e) => { if (e.target.value !== String(raw ?? '')) setCpValue(task, def.id, e.target.value === '' ? '' : Number(e.target.value)); }}
          />
        );
      default: // text, url, email, phone
        return (
          <input
            type="text"
            className="tt-cell-input"
            key={`${task.id}_${raw ?? ''}`}
            defaultValue={raw ?? ''}
            placeholder="—"
            onBlur={(e) => { if (e.target.value !== String(raw ?? '')) setCpValue(task, def.id, e.target.value); }}
          />
        );
    }
  };

  const renderCell = (task, col) => {
    const editable = canEditTask(task);
    if (col.cp) return renderCpCell(task, col.cp, editable);
    switch (col.key) {
      case 'title':
        return (
          <span className="tt-title-cell">
            <input
              className="tt-title-input"
              key={`${task.id}_${task.title}`}
              defaultValue={task.title}
              disabled={!editable}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== task.title) onInlineUpdate(task.id, { title: v }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = task.title; e.target.blur(); } }}
            />
            <button className="tt-open-btn" onClick={() => onOpen(task)} title="Open task">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/></svg>
              Open
            </button>
          </span>
        );
      case 'project':
        return editable ? (
          <select className="tt-select" value={task.projectId || ''} onChange={(e) => onInlineUpdate(task.id, { projectId: e.target.value || null })}>
            <option value="">—</option>
            {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
        ) : (
          <span className="tt-muted">{projectName(task.projectId) || '—'}</span>
        );
      case 'sprint':
        return editable ? (
          <select className="tt-select" value={task.sprintId || ''} onChange={(e) => onInlineUpdate(task.id, { sprintId: e.target.value || null })}>
            <option value="">—</option>
            {sprints.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        ) : (
          <span className="tt-muted">{sprintName(task.sprintId) || '—'}</span>
        );
      case 'priority': {
        const c = priorityColor[task.priority];
        const pillStyle = task.priority ? { background: c + '1a', color: c } : {};
        return editable ? (
          <select
            className={`tt-select tt-pill ${task.priority ? '' : 'tt-pill-empty'}`}
            value={task.priority || ''}
            style={pillStyle}
            onChange={(e) => onInlineUpdate(task.id, { priority: e.target.value })}
          >
            <option value="">None</option>
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          task.priority ? <span className="tt-pill" style={pillStyle}>{task.priority}</span> : <span className="tt-muted">—</span>
        );
      }
      case 'status':
        return (
          <span className="tt-status">
            <span className={`tt-status-dot ${STATUS_DOT[task.status] || 'dot-notstarted'}`} />
            <select
              className={`tt-select tt-pill badge ${STATUS_BADGE[task.status] || 'badge-notstarted'}`}
              value={task.status}
              disabled={!editable}
              onChange={(e) => onStatusChange(task.id, e.target.value)}
            >
              {statuses.map(s => <option key={s} value={s} disabled={!canChangeStatusTo(task, s)}>{s}</option>)}
            </select>
          </span>
        );
      case 'assignee':
        return (
          <span className={`tt-person ${task.assignee ? '' : 'tt-person-empty'}`}>
            {task.assignee ? <Avatar name={task.assignee} members={teamMembers} size={20} /> : <span className="tt-person-blank" />}
            {editable ? (
              <select className="tt-select tt-person-select" value={task.assignee || ''} onChange={(e) => onInlineUpdate(task.id, { assignee: e.target.value })}>
                <option value="">Unassigned</option>
                {teamMembers.map(m => <option key={m._id} value={m.name}>{m.name}</option>)}
              </select>
            ) : (
              <span className="tt-person-name">{task.assignee || 'Unassigned'}</span>
            )}
          </span>
        );
      case 'dueDate': {
        const overdue = task.dueDate && task.status !== 'Completed' && new Date(task.dueDate) < new Date(new Date().toDateString());
        return editable ? (
          <input
            type="date"
            className={`tt-cell-input tt-date ${overdue ? 'tt-overdue' : ''}`}
            value={task.dueDate ? String(task.dueDate).slice(0, 10) : ''}
            onChange={(e) => onInlineUpdate(task.id, { dueDate: e.target.value || null })}
          />
        ) : (
          <span className={`tt-muted ${overdue ? 'tt-overdue' : ''}`}>{formatDate(task.dueDate) || '—'}</span>
        );
      }
      case 'tags':
        return task.taskType?.length ? (
          <span className="tt-tags">
            {task.taskType.slice(0, 3).map(t => { const [bg, fg] = tagColor(t); return <span key={t} className="tt-tag" style={{ background: bg, color: fg }}>{t}</span>; })}
            {task.taskType.length > 3 && <span className="tt-muted">+{task.taskType.length - 3}</span>}
          </span>
        ) : <span className="tt-muted">—</span>;
      case 'progress': {
        const pct = taskProgress(task);
        return (
          <span className="tt-progress" title={`${pct}% complete`}>
            <span className="tt-progress-bar"><i style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--accent-green)' : 'var(--primary)' }} /></span>
            <span className="tt-progress-pct">{pct}%</span>
          </span>
        );
      }
      case 'createdDate':
        return <span className="tt-muted">{formatDate(task.createdDate) || '—'}</span>;
      case 'estimatedHours':
      case 'actualHours':
        return editable ? (
          <span className="tt-hours">
            <input
              type="number"
              min="0"
              step="0.5"
              className="tt-cell-input tt-hours-input"
              key={`${task.id}_${col.key}_${task[col.key] ?? 0}`}
              defaultValue={task[col.key] || 0}
              onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== (task[col.key] || 0)) onInlineUpdate(task.id, { [col.key]: v }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            />
            <em>h</em>
          </span>
        ) : (
          <span className="tt-muted">{task[col.key] || 0}h</span>
        );
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
                      {allColumns.filter(c => c.key === s.key || !sorts.some(x => x.key === c.key)).map(c => (
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
                {allColumns.filter(c => !c.always).map(c => (
                  <label key={c.key} className="tt-popover-row">
                    <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                    <span className="tt-popover-row-label">{c.label}</span>
                    {c.cp && onDeleteProperty && (
                      <button
                        className="btn-icon tt-prop-delete"
                        style={{ width: 20, height: 20 }}
                        title="Delete property"
                        onClick={(e) => { e.preventDefault(); onDeleteProperty(c.cp.id); }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    )}
                  </label>
                ))}
                {onCreateProperty && <NewPropertyForm onCreate={onCreateProperty} />}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tt-table-wrap">
        <table className="tt-table">
          <thead>
            <tr>
              {onToggleSelect && (
                <th className="tt-check-col">
                  <input
                    type="checkbox"
                    className="tt-row-check"
                    checked={tasks.length > 0 && selectedIds.length === tasks.length}
                    onChange={(e) => onToggleSelectAll?.(e.target.checked)}
                  />
                </th>
              )}
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
                  <td colSpan={visibleCols.length + 1 + (onToggleSelect ? 1 : 0)}>
                    <span className="tt-group-head">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: collapsed[group.name] ? 'none' : 'rotate(90deg)', transition: 'transform 0.12s' }}><polyline points="9 6 15 12 9 18"/></svg>
                      {groupBy === 'status' && <span className={`tt-status-dot ${STATUS_DOT[group.name] || 'dot-notstarted'}`} />}
                      {groupBy === 'priority' && priorityColor[group.name] && <span className="tt-status-dot" style={{ background: priorityColor[group.name] }} />}
                      {groupBy === 'assignee' && group.name !== 'No assignee' && (
                        <Avatar name={group.name} members={teamMembers} size={20} />
                      )}
                      <span className="tt-group-name">{group.name}</span>
                      <span className="tt-group-count">{group.rows.length}</span>
                    </span>
                  </td>
                </tr>
              )}
              {!collapsed[group.name] && group.rows.map(task => (
                <tr key={task.id} className={selectedIds.includes(task.id) ? 'tt-row-selected' : ''}>
                  {onToggleSelect && (
                    <td className="tt-check-col">
                      <input
                        type="checkbox"
                        className="tt-row-check"
                        checked={selectedIds.includes(task.id)}
                        onChange={(e) => onToggleSelect(task.id, e.target.checked)}
                      />
                    </td>
                  )}
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
              {/* + New task (inherits the group's value, Notion-style) */}
              {onCreateTask && !collapsed[group.name] && (
                <tr className="tt-newrow">
                  <td colSpan={visibleCols.length + 1 + (onToggleSelect ? 1 : 0)}>
                    {newRowGroup === (group.name ?? '__ALL__') ? (
                      <input
                        className="tt-newrow-input"
                        placeholder="Type a task name…"
                        autoFocus
                        onBlur={(e) => commitNewRow(e, group)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.target.blur();
                          if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); }
                        }}
                      />
                    ) : (
                      <button className="tt-newrow-btn" onClick={() => setNewRowGroup(group.name ?? '__ALL__')}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New task
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          ))}

          {/* Calculate row (Notion-style aggregates over the filtered rows) */}
          {tasks.length > 0 && (
            <tfoot>
              <tr className="tt-calc-row">
                {onToggleSelect && <td className="tt-check-col" />}
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
                        {(isNumericCol(col.key) ? CALC_OPTIONS_NUM : CALC_OPTIONS_BASE).map(([op, label]) => (
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
