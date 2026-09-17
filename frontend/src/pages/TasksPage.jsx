import { useState, useEffect, useRef } from 'react';
import { getTasks, createTask, updateTask, deleteTask, getTeam, getProjects, getSprints, getTeamspaces, updateTeamspaceViews, getProperties, createProperty, deleteProperty } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import TaskDetailPage from './TaskDetailPage';
import ViewTabs from '../components/ViewTabs';
import FileTypeIcon from '../components/FileTypeIcon';
import TaskTable from '../components/TaskTable';
import TaskPanel from '../components/TaskPanel';
import { tagColor } from '../components/taskUtils';
import CalendarView from '../components/CalendarView';
import TimelineView from '../components/TimelineView';
import { AvatarStack } from '../components/Avatar';
import './TasksPage.css';

const STATUSES = ['Not Yet Started', 'In Progress', 'In Review', 'Completed', 'Rejected'];

const STATUS_DOT = {
  'Not Yet Started': 'dot-notstarted',
  'In Progress': 'dot-progress',
  'In Review': 'dot-review',
  'Completed': 'dot-done',
  'Rejected': 'dot-rejected',
};

const STATUS_BADGE = {
  'Not Yet Started': 'badge-notstarted',
  'In Progress': 'badge-progress',
  'In Review': 'badge-review',
  'Completed': 'badge-done',
  'Rejected': 'badge-rejected',
};

// Accent color per status — kanban column bars, calendar dots, timeline bars
const STATUS_COLOR = {
  'Not Yet Started': 'var(--text-muted)',
  'In Progress': 'var(--accent-blue)',
  'In Review': 'var(--accent-orange)',
  'Completed': 'var(--accent-green)',
  'Rejected': 'var(--accent-red)',
};
const COLUMN_LABEL = { 'Not Yet Started': 'To Do', 'In Progress': 'In Progress', 'In Review': 'In Review', 'Completed': 'Completed', 'Rejected': 'Rejected' };

// Short, stable display id for a card (e.g. T-3F9A) derived from the task id
const shortId = (t) => 'T-' + String(t.id || t._id || '').replace(/^task_/, '').replace(/-/g, '').slice(-4).toUpperCase();

// Plain-text preview of the block-based description
const descText = (task) => {
  if (!task.description) return '';
  try {
    const parsed = JSON.parse(task.description);
    if (Array.isArray(parsed)) return parsed.filter(b => b.content).map(b => b.content.replace(/^\[[ x]\]\s*/, '')).join(' ');
  } catch { /* plain string */ }
  return task.description;
};

export default function TasksPage() {
  const { user } = useAuth();
  const { activeTeamspaceId } = useTeamspace();
  const [tasks, setTasks] = useState([]);

  // ── Views (Notion-style shared database views) ──────────────────────
  // A view = { id, name, type, filters, sorts, groupBy, hiddenColumns }.
  // Real teamspaces store views on the server (shared by every member);
  // the Personal space keeps them in localStorage.
  const DEFAULT_VIEWS = [
    { id: 'v_board', name: 'Kanban', type: 'board', filters: null, sorts: [], groupBy: '', hiddenColumns: [] },
    { id: 'v_table', name: 'Table', type: 'table', filters: null, sorts: [], groupBy: '', hiddenColumns: ['createdDate'] },
    { id: 'v_list', name: 'List', type: 'list', filters: null, sorts: [], groupBy: '', hiddenColumns: [] },
    { id: 'v_calendar', name: 'Calendar', type: 'calendar', filters: null, sorts: [], groupBy: '', hiddenColumns: [] },
    { id: 'v_timeline', name: 'Timeline', type: 'timeline', filters: null, sorts: [], groupBy: '', hiddenColumns: [] },
  ];
  const isPersonalSpace = !activeTeamspaceId || activeTeamspaceId === '__personal__';
  const tsKey = isPersonalSpace ? 'personal' : activeTeamspaceId;

  const [views, setViews] = useState(DEFAULT_VIEWS);
  const [activeViewId, setActiveViewId] = useState('v_board');
  const activeView = views.find(v => v.id === activeViewId) || views[0] || DEFAULT_VIEWS[0];
  const viewType = activeView.type || 'board';

  const saveTimer = useRef(null);
  const persistViews = (next) => {
    if (isPersonalSpace) {
      localStorage.setItem('tasks_views_personal', JSON.stringify(next));
      return;
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateTeamspaceViews(activeTeamspaceId, next).catch(err => console.error('view save failed', err));
    }, 700);
  };
  const applyViews = (next) => { setViews(next); persistViews(next); };
  const patchActiveView = (patch) => {
    setViews(prev => {
      const next = prev.map(v => v.id === activeViewId ? { ...v, ...patch } : v);
      persistViews(next);
      return next;
    });
  };

  // Load views whenever the teamspace changes
  useEffect(() => {
    const rememberedId = localStorage.getItem(`tasks_active_view_${tsKey}`);
    const finish = (loaded) => {
      const vs = loaded && loaded.length ? loaded : DEFAULT_VIEWS;
      setViews(vs);
      setActiveViewId(vs.some(v => v.id === rememberedId) ? rememberedId : vs[0].id);
    };
    if (isPersonalSpace) {
      try { finish(JSON.parse(localStorage.getItem('tasks_views_personal'))); } catch { finish(null); }
    } else {
      getTeamspaces()
        .then(res => finish(res.data.find(t => t._id === activeTeamspaceId)?.views))
        .catch(() => finish(null));
    }
  }, [activeTeamspaceId]);

  useEffect(() => {
    localStorage.setItem(`tasks_active_view_${tsKey}`, activeViewId);
  }, [activeViewId, tsKey]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null); // opens the slide-over panel
  const [fullTask, setFullTask] = useState(null);         // opens the full-page editor
  const [colMenu, setColMenu] = useState(null);           // kanban column "⋮" menu
  const [teamMembers, setTeamMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [selectedTasksIds, setSelectedTasksIds] = useState([]);

  const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
  const PRIORITY_COLOR = { Urgent: '#d44c47', High: '#d9730d', Medium: '#2383e2', Low: '#2e9e6b' };

  // Custom property definitions (Notion-style database properties)
  const [customProps, setCustomProps] = useState([]);
  const cpValue = (t, defId) => t.customProperties?.find(p => p.definitionId === defId)?.value;
  const CP_FILTER_TYPE = {
    text: 'text', url: 'text', email: 'text', phone: 'text',
    number: 'number', date: 'date', select: 'select',
    multiSelect: 'multiselect', checkbox: 'checkbox',
  };

  // Filterable fields and their operators (Notion-style)
  const FILTER_FIELDS = {
    title:    { label: 'Task name', type: 'text' },
    assignee: { label: 'Assignee',  type: 'select' },
    project:  { label: 'Project',   type: 'select' },
    sprint:   { label: 'Sprint',    type: 'select' },
    status:   { label: 'Status',    type: 'select' },
    priority: { label: 'Priority',  type: 'select' },
    dueDate:  { label: 'Due date',  type: 'date' },
    ...Object.fromEntries(customProps.map(d => [
      `cp_${d.id}`, { label: d.name, type: CP_FILTER_TYPE[d.type] || 'text', cp: d },
    ])),
  };
  const FILTER_OPS = {
    text: [
      ['contains', 'contains'], ['not_contains', "doesn't contain"],
      ['is_empty', 'is empty'], ['is_not_empty', 'is not empty'],
    ],
    select: [
      ['is', 'is'], ['is_not', 'is not'],
      ['is_any_of', 'is any of'], ['is_none_of', 'is none of'],
      ['is_empty', 'is empty'], ['is_not_empty', 'is not empty'],
    ],
    multiselect: [
      ['m_contains', 'contains'], ['m_not_contains', "doesn't contain"],
      ['is_empty', 'is empty'], ['is_not_empty', 'is not empty'],
    ],
    date: [
      ['is', 'is'], ['before', 'is before'], ['after', 'is after'],
      ['on_or_before', 'is on or before'], ['on_or_after', 'is on or after'],
      ['is_empty', 'is empty'], ['is_not_empty', 'is not empty'],
    ],
    number: [
      ['eq', '='], ['neq', '≠'], ['gt', '>'], ['lt', '<'], ['gte', '≥'], ['lte', '≤'],
      ['is_empty', 'is empty'], ['is_not_empty', 'is not empty'],
    ],
    checkbox: [
      ['is_checked', 'is checked'], ['is_unchecked', 'is unchecked'],
    ],
  };
  const NO_VALUE_OPS = ['is_empty', 'is_not_empty', 'is_checked', 'is_unchecked'];

  // Relative date values (Notion-style) — stored as @tokens, resolved at
  // evaluation time so "is after today" stays correct tomorrow.
  const REL_DATES = [
    ['@today', 'Today'], ['@tomorrow', 'Tomorrow'], ['@yesterday', 'Yesterday'],
    ['@week_ago', 'One week ago'], ['@week_from_now', 'One week from now'],
    ['@month_ago', 'One month ago'], ['@month_from_now', 'One month from now'],
  ];
  const resolveDateValue = (v) => {
    if (!v || !String(v).startsWith('@')) return v;
    const d = new Date();
    if (v === '@month_ago') d.setMonth(d.getMonth() - 1);
    else if (v === '@month_from_now') d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + ({ '@today': 0, '@tomorrow': 1, '@yesterday': -1, '@week_ago': -7, '@week_from_now': 7 }[v] || 0));
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const relDateLabel = (v) => REL_DATES.find(([tok]) => tok === v)?.[1];

  const MULTI_OPS = ['is_any_of', 'is_none_of'];
  const fieldOptions = (field) => {
    if (field.startsWith('cp_')) {
      const def = customProps.find(d => d.id === field.slice(3));
      return (def?.options || []).map(o => ({ v: o, l: o }));
    }
    switch (field) {
      case 'assignee': return teamMembers.map(m => ({ v: m.name, l: m.name }));
      case 'project': return projects.map(p => ({ v: p._id, l: p.name }));
      case 'sprint': return sprints.map(s => ({ v: s._id, l: s.name }));
      case 'status': return STATUSES.map(s => ({ v: s, l: s }));
      case 'priority': return PRIORITIES.map(p => ({ v: p, l: p }));
      default: return [];
    }
  };

  // ── Notion-style rule filters — live on the ACTIVE VIEW ──────────────
  const [openFilter, setOpenFilter] = useState(null); // filter panel open?
  const [openMulti, setOpenMulti] = useState(null);   // rule id with open multi-select
  const [searchQuery, setSearchQuery] = useState(''); // personal, not saved to the view
  const filterRules = activeView.filters?.rules || [];
  const filterConj = activeView.filters?.conjunction || 'and';
  const setFilterRules = (updater) => {
    const rules = typeof updater === 'function' ? updater(filterRules) : updater;
    patchActiveView({ filters: { conjunction: filterConj, rules } });
  };
  const setFilterConj = (conjunction) => {
    patchActiveView({ filters: { conjunction, rules: filterRules } });
  };

  const dragItem = useRef(null);

  useEffect(() => {
    fetchTasks();
    fetchTeam();
    fetchProjects();
    fetchSprints();
    getProperties().then(res => setCustomProps(res.data)).catch(() => {});
  }, [activeTeamspaceId]);

  // Inline "+ New task" rows in the table (inherits the group's value)
  const handleInlineCreate = async (data) => {
    try {
      await createTask({
        id: `task_${Date.now()}`,
        title: data.title,
        description: '',
        status: data.status || 'Not Yet Started',
        assignee: data.assignee || '',
        priority: data.priority || '',
        dueDate: null,
        createdDate: new Date().toISOString(),
        customProperties: [],
        attachments: [],
        parentId: null,
        projectId: data.projectId ?? (filterRules.find(r => r.field === 'project' && r.op === 'is' && r.value)?.value || null),
        sprintId: data.sprintId ?? (filterRules.find(r => r.field === 'sprint' && r.op === 'is' && r.value)?.value || null),
        estimatedHours: 0,
        actualHours: 0,
      });
      await fetchTasks();
    } catch (err) { console.error(err); }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedTasksIds.length} selected tasks? This cannot be undone.`)) return;
    for (const id of selectedTasksIds) {
      const t = tasks.find(x => (x.id || x._id) === id);
      if (t && canEditTask(t)) {
        try { await deleteTask(id); } catch (err) { console.error(err); }
      }
    }
    setSelectedTasksIds([]);
    fetchTasks();
  };

  const handleCreateProperty = async (def) => {
    try {
      await createProperty({ id: `p_${Date.now()}`, ...def });
      const res = await getProperties();
      setCustomProps(res.data);
    } catch (err) { console.error(err); }
  };

  const handleDeleteProperty = async (id) => {
    if (!confirm('Delete this property for the whole workspace? Its values on every task are removed too.')) return;
    try {
      await deleteProperty(id);
      setCustomProps(prev => prev.filter(p => p.id !== id));
      fetchTasks();
    } catch (err) { console.error(err); }
  };

  const fetchTasks = async () => {
    try {
      const res = await getTasks(activeTeamspaceId);
      setTasks(res.data);
      if (window.pendingOpenTaskId) {
        const task = res.data.find(t => t._id === window.pendingOpenTaskId || t.id === window.pendingOpenTaskId);
        if (task) setSelectedTask(task);
        window.pendingOpenTaskId = null;
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchTeam = async () => {
    try { const res = await getTeam(); setTeamMembers(res.data); }
    catch (err) { console.error(err); }
  };

  const fetchProjects = async () => {
    try { const res = await getProjects(); setProjects(res.data); }
    catch (err) { console.error(err); }
  };

  const fetchSprints = async () => {
    try { const res = await getSprints(activeTeamspaceId); setSprints(res.data); }
    catch (err) { console.error(err); }
  };

  // New task — optionally straight into a kanban column's status
  const handleCreateNew = async (status = 'Not Yet Started') => {
    try {
      const newTask = {
        id: `task_${Date.now()}`,
        title: 'Untitled',
        description: '',
        status: typeof status === 'string' ? status : 'Not Yet Started',
        assignee: '',
        priority: '',
        dueDate: null,
        createdDate: new Date().toISOString(),
        customProperties: [],
        attachments: [],
        taskType: [],
        parentId: null,
        // Pre-fill the project/sprint when a single "is …" filter is active
        projectId: filterRules.find(r => r.field === 'project' && r.op === 'is' && r.value)?.value || null,
        sprintId: filterRules.find(r => r.field === 'sprint' && r.op === 'is' && r.value)?.value || null,
        estimatedHours: 0,
        actualHours: 0,
      };
      const res = await createTask(newTask);
      await fetchTasks();
      setSelectedTask(res.data || newTask);
    } catch (err) { console.error(err); }
  };

  const isAdminOrOwner = user?.role === 'Admin' || user?.role === 'Team Owner';

  const canEditTask = (task) => {
    if (isAdminOrOwner) return true;
    return task.assignee === user?.name;
  };

  const canChangeStatusTo = (task, newStatus) => {
    if (!canEditTask(task)) return false;
    if (isAdminOrOwner) return true;
    if (newStatus === 'Completed' || newStatus === 'Rejected') return false;
    return true;
  };

  const handleStatusChange = async (taskId, newStatus) => {
    const task = tasks.find(t => t.id === taskId);
    if (task && !canChangeStatusTo(task, newStatus)) return;
    try { await updateTask(taskId, { status: newStatus }); fetchTasks(); }
    catch (err) { console.error(err); }
  };

  // Inline table edits (assignee / priority)
  const handleInlineUpdate = async (taskId, patch) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !canEditTask(task)) return;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t));
    try { await updateTask(taskId, patch); fetchTasks(); }
    catch (err) { console.error(err); fetchTasks(); }
  };

  // Per-column filter hookup for the table's header menus: upserts an
  // "is <value>" rule for that field (empty value clears the field's rules)
  const applyColumnFilter = (field, value) => {
    setFilterRules(rules => {
      const rest = rules.filter(r => r.field !== field);
      if (!value) return rest;
      return [...rest, { id: `r${Date.now()}`, field, op: 'is', value }];
    });
  };

  const handleDelete = async (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task || !canEditTask(task)) return;
    try { await deleteTask(id); fetchTasks(); }
    catch (err) { console.error(err); }
  };

  // Drag & Drop
  const handleDragStart = (e, task) => {
    if (!canEditTask(task)) {
      e.preventDefault();
      return;
    }
    dragItem.current = task;
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
  };
  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging');
    dragItem.current = null;
    document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over'));
  };
  const handleDragOver = (e, status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over'));
    e.currentTarget.closest('.board-column')?.classList.add('drag-over');
  };
  const handleDrop = async (e, status) => {
    e.preventDefault();
    document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over'));
    const task = dragItem.current;
    if (task && task.status !== status) {
      if (!canChangeStatusTo(task, status)) {
        dragItem.current = null;
        return;
      }
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
      try { await updateTask(task.id, { status }); }
      catch { fetchTasks(); }
    }
    dragItem.current = null;
  };

  // ── Filter rule evaluation ──────────────────────────────
  const ruleRaw = (t, field) => {
    if (field.startsWith('cp_')) return cpValue(t, field.slice(3));
    return {
      title: t.title, assignee: t.assignee, project: t.projectId, sprint: t.sprintId,
      status: t.status, priority: t.priority, dueDate: t.dueDate,
    }[field];
  };

  const sameDay = (a, b) => {
    const d = new Date(a);
    const e = new Date(b + 'T00:00:00');
    return d.getFullYear() === e.getFullYear() && d.getMonth() === e.getMonth() && d.getDate() === e.getDate();
  };

  const matchRule = (t, r) => {
    const raw = ruleRaw(t, r.field);
    const type = FILTER_FIELDS[r.field]?.type;
    const val = type === 'date' ? resolveDateValue(r.value) : r.value;
    const empty = raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    switch (r.op) {
      case 'is_empty': return empty;
      case 'is_not_empty': return !empty;
      case 'is_checked': return raw === true;
      case 'is_unchecked': return raw !== true;
      case 'contains': return String(raw || '').toLowerCase().includes(String(val || '').toLowerCase());
      case 'not_contains': return !String(raw || '').toLowerCase().includes(String(val || '').toLowerCase());
      case 'm_contains': return Array.isArray(raw) && raw.includes(val);
      case 'm_not_contains': return !Array.isArray(raw) || !raw.includes(val);
      case 'is': return type === 'date' ? (!!raw && sameDay(raw, val)) : raw === val;
      case 'is_not': return type === 'date' ? (!raw || !sameDay(raw, val)) : raw !== val;
      case 'is_any_of': return Array.isArray(val) && val.includes(raw);
      case 'is_none_of': return !Array.isArray(val) || !val.includes(raw);
      case 'before': return !!raw && new Date(raw) < new Date(val + 'T00:00:00');
      case 'after': return !!raw && new Date(raw) > new Date(val + 'T23:59:59');
      case 'on_or_before': return !!raw && new Date(raw) <= new Date(val + 'T23:59:59');
      case 'on_or_after': return !!raw && new Date(raw) >= new Date(val + 'T00:00:00');
      case 'eq': return !empty && Number(raw) === Number(val);
      case 'neq': return empty || Number(raw) !== Number(val);
      case 'gt': return !empty && Number(raw) > Number(val);
      case 'lt': return !empty && Number(raw) < Number(val);
      case 'gte': return !empty && Number(raw) >= Number(val);
      case 'lte': return !empty && Number(raw) <= Number(val);
      default: return true;
    }
  };

  // Rules missing a needed value are inactive until filled in
  const activeRules = filterRules.filter(r =>
    NO_VALUE_OPS.includes(r.op)
    || (Array.isArray(r.value) ? r.value.length > 0 : (r.value !== '' && r.value != null))
  );

  const filteredTasks = tasks.filter(t => {
    if (t.parentId) return false;
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (activeRules.length === 0) return true;
    return filterConj === 'and' ? activeRules.every(r => matchRule(t, r)) : activeRules.some(r => matchRule(t, r));
  });

  const singleValueLabel = (field, v) => {
    if (field === 'project') return projects.find(p => p._id === v)?.name || v;
    if (field === 'sprint') return sprints.find(s => s._id === v)?.name || v;
    return v;
  };
  const ruleValueLabel = (r) => {
    if (NO_VALUE_OPS.includes(r.op)) return '';
    if (Array.isArray(r.value)) return r.value.map(v => singleValueLabel(r.field, v)).join(', ');
    if (FILTER_FIELDS[r.field]?.type === 'date') return relDateLabel(r.value) || r.value;
    return singleValueLabel(r.field, r.value);
  };
  const opLabel = (r) => (FILTER_OPS[FILTER_FIELDS[r.field]?.type] || []).find(([op]) => op === r.op)?.[1] || r.op;

  // Chips under the toolbar — one per active rule
  const activeFilters = activeRules.map(r => ({
    key: r.id,
    label: FILTER_FIELDS[r.field]?.label || r.field,
    value: `${opLabel(r)}${ruleValueLabel(r) ? ` ${ruleValueLabel(r)}` : ''}`,
    clear: () => setFilterRules(rules => rules.filter(x => x.id !== r.id)),
  }));

  // Rule list editing
  const addRule = (field = 'assignee') => {
    const type = FILTER_FIELDS[field].type;
    setFilterRules(rules => [...rules, { id: `r${Date.now()}_${rules.length}`, field, op: FILTER_OPS[type][0][0], value: '' }]);
  };
  const updateRule = (id, patch) => {
    setFilterRules(rules => rules.map(r => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      if (patch.field && patch.field !== r.field) {
        next.op = FILTER_OPS[FILTER_FIELDS[patch.field].type][0][0];
        next.value = '';
      }
      return next;
    }));
  };
  const removeRule = (id) => setFilterRules(rules => rules.filter(r => r.id !== id));

  const getTasksByStatus = (status) => filteredTasks.filter(t => t.status === status);

  const getProjectName = (projectId) => {
    const p = projects.find(pr => pr._id === projectId);
    return p ? `${p.icon} ${p.name}` : '';
  };

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const formatShort = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

  const renderAvatar = (name) => {
    const member = teamMembers.find(m => m.name === name);
    if (member?.profilePictureUrl) {
      return <img src={member.profilePictureUrl} alt={name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />;
    }
    return name.charAt(0).toUpperCase();
  };

  // Progress: subtasks done → hours used → a sensible status default
  const taskProgress = (t) => {
    const subs = tasks.filter(x => x.parentId === t.id);
    if (subs.length) return Math.round((100 * subs.filter(s => s.status === 'Completed').length) / subs.length);
    if (t.estimatedHours > 0) return Math.min(100, Math.round((100 * (t.actualHours || 0)) / t.estimatedHours));
    return { 'Not Yet Started': 0, 'In Progress': 35, 'In Review': 80, 'Completed': 100, 'Rejected': 0 }[t.status] ?? 0;
  };

  // In v5, filters/sorts live ON the shared view — every edit saves for the
  // whole teamspace automatically (Notion semantics). Personal space stays local.
  const clearFilters = () => {
    setFilterRules([]);
    setSearchQuery('');
  };

  // Full-page editor (from the panel's "Open full page")
  if (fullTask) {
    return (
      <TaskDetailPage
        task={fullTask}
        onBack={() => { setFullTask(null); fetchTasks(); }}
        onUpdated={fetchTasks}
      />
    );
  }

  if (loading) {
    return <div className="tasks-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;
  }

  const handleAddView = (type, label) => {
    const newId = `v${Date.now()}`;
    const newView = { id: newId, name: label, type, filters: null, sorts: [], groupBy: '', hiddenColumns: [] };
    applyViews([...views, newView]);
    setActiveViewId(newId);
  };

  const handleRenameView = (viewId, name) => {
    if (!name?.trim()) return;
    applyViews(views.map(v => v.id === viewId ? { ...v, name: name.trim() } : v));
  };

  const handleDeleteView = (viewId) => {
    if (views.length <= 1) return;
    const next = views.filter(v => v.id !== viewId);
    applyViews(next);
    if (activeViewId === viewId) setActiveViewId(next[0].id);
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) setSelectedTasksIds(filteredTasks.map(t => t.id || t._id));
    else setSelectedTasksIds([]);
  };

  const handleSelectTask = (e, id) => {
    if (e.target.checked) setSelectedTasksIds([...selectedTasksIds, id]);
    else setSelectedTasksIds(selectedTasksIds.filter(i => i !== id));
  };

  const handleBulkChangeSprint = async (sprintId) => {
    for (const taskId of selectedTasksIds) {
      await updateTask(taskId, { sprintId: sprintId === 'None' ? null : sprintId });
    }
    setSelectedTasksIds([]);
    fetchTasks();
  };

  // The panel always shows the freshest copy of the selected task
  const panelTask = selectedTask ? (tasks.find(t => t.id === selectedTask.id) || selectedTask) : null;

  // Page header context: the project / sprint a single "is …" filter points at
  const projectFilterId = filterRules.find(r => r.field === 'project' && r.op === 'is' && r.value)?.value;
  const activeProject = projects.find(p => p._id === projectFilterId);
  const sprintFilterId = filterRules.find(r => r.field === 'sprint' && r.op === 'is' && r.value)?.value;
  const activeSprint = sprints.find(s => s._id === sprintFilterId);
  const doneCount = filteredTasks.filter(t => t.status === 'Completed').length;
  const inReview = filteredTasks.filter(t => t.status === 'In Review').length;

  const renderCard = (task, i) => {
    const pct = taskProgress(task);
    const tag = task.taskType?.[0];
    const [tagBg, tagFg] = tag ? tagColor(tag) : [];
    const people = [task.assignee, ...(task.comments || []).map(c => c.author)];
    const overdue = task.dueDate && task.status !== 'Completed' && new Date(task.dueDate) < new Date(new Date().toDateString());
    const preview = descText(task);
    return (
      <div className="task-card animate-in" key={task.id}
        style={{ animationDelay: `${Math.min(i, 12) * 0.03}s`, opacity: canEditTask(task) ? 1 : 0.85 }}
        draggable={canEditTask(task)} onDragStart={(e) => handleDragStart(e, task)} onDragEnd={handleDragEnd}
        onClick={() => setSelectedTask(task)}
      >
        <div className="kb-top">
          {task.priority && (
            <span className="kb-badge" style={{ background: PRIORITY_COLOR[task.priority] + '1a', color: PRIORITY_COLOR[task.priority] }}>{task.priority}</span>
          )}
          {tag && <span className="kb-badge" style={{ background: tagBg, color: tagFg }}>{tag}</span>}
          {!task.priority && !tag && task.projectId && <span className="kb-badge kb-badge-muted">{getProjectName(task.projectId)}</span>}
          <span className="kb-id">{shortId(task)}</span>
        </div>
        <h4 className="kb-title">{task.title}</h4>
        {preview && <p className="kb-desc">{preview}</p>}
        <div className="kb-progress">
          <div className="kb-progress-row">
            <span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 11-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>
              Progress
            </span>
            <b>{pct}%</b>
          </div>
          <div className="kb-progress-bar"><i style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--accent-green)' : 'var(--primary)' }} /></div>
        </div>
        <div className="kb-footer">
          <div className="kb-footer-left">
            <AvatarStack names={people} members={teamMembers} size={22} max={3} />
            {task.dueDate && (
              <span className={`kb-due ${overdue ? 'overdue' : ''}`} title={overdue ? 'Overdue' : 'Due date'}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                {formatShort(task.dueDate)}
              </span>
            )}
          </div>
          <div className="kb-counts">
            <span title="Comments">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              {task.comments?.length || 0}
            </span>
            <span title="Attachments">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
              {task.attachments?.length || 0}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="tasks-page">
      {/* ─── Page header: project context + team + new task ─── */}
      <div className="pg-header">
        <div className="pg-header-left">
          <div className="pg-proj">{activeProject?.icon || (activeProject?.name || 'T').charAt(0).toUpperCase()}</div>
          <div className="pg-header-text">
            <h1 className="pg-title">
              {activeProject ? activeProject.name : activeSprint ? activeSprint.name : 'All tasks'}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="6 9 12 15 18 9"/></svg>
            </h1>
            <div className="pg-meta">
              <span><b>{filteredTasks.length}</b> tasks</span>
              <span><b>{doneCount}</b> completed</span>
              {inReview > 0 && <span><b>{inReview}</b> in review</span>}
              {activeSprint && activeProject && <span>Sprint: <b>{activeSprint.name}</b></span>}
              {activeProject?.status && <span>Status: <b className="pg-status">{activeProject.status}</b></span>}
            </div>
          </div>
        </div>
        <div className="pg-header-right">
          <AvatarStack names={teamMembers.map(m => m.name)} members={teamMembers} size={30} max={4} />
          <button className="btn btn-primary" onClick={() => handleCreateNew()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Task
          </button>
        </div>
      </div>

      {/* ─── Controls: view switcher + search + filter ─── */}
      <div className="pg-controls">
        <ViewTabs
          views={views}
          activeViewId={activeViewId}
          onChangeView={setActiveViewId}
          onAddView={handleAddView}
          onRenameView={handleRenameView}
          onDeleteView={handleDeleteView}
          allowedTypes={['board', 'calendar', 'timeline', 'list', 'table']}
        />

        <div className="pg-controls-right">
          {/* Search */}
          <div className="search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="search-input" placeholder="Search tasks..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>

          {/* Filter trigger */}
          <div className="filter-dropdown-root">
            <button
              className={`btn btn-ghost btn-sm filter-trigger ${openFilter || activeFilters.length ? 'active-filter' : ''}`}
              onClick={() => setOpenFilter(openFilter ? null : 'assignee')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/></svg>
              Filter{activeFilters.length > 0 && <span className="filter-count">{activeFilters.length}</span>}
            </button>

            {/* Filter panel — Notion-style rule builder */}
            {openFilter && (
              <div className="filter-panel filter-panel-rules animate-in" onClick={e => e.stopPropagation()}>
                <div className="filter-panel-header">
                  <span>Filters</span>
                  <button className="btn-icon" onClick={() => setOpenFilter(null)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>

                {filterRules.length === 0 && (
                  <p className="filter-panel-hint" style={{ margin: '8px 16px' }}>No filters yet. Add one below — e.g. Assignee is Pooja, Due date is after a day, Status is not Completed.</p>
                )}

                {filterRules.map((r, i) => {
                  const type = FILTER_FIELDS[r.field].type;
                  const needsValue = !NO_VALUE_OPS.includes(r.op);
                  return (
                    <div className="fr-row" key={r.id}>
                      <span className="fr-conj">
                        {i === 0 ? 'Where' : (
                          i === 1 ? (
                            <select className="fr-select fr-conj-select" value={filterConj} onChange={e => setFilterConj(e.target.value)}>
                              <option value="and">And</option>
                              <option value="or">Or</option>
                            </select>
                          ) : (filterConj === 'and' ? 'And' : 'Or')
                        )}
                      </span>
                      <select className="fr-select fr-field" value={r.field} onChange={e => updateRule(r.id, { field: e.target.value })}>
                        {Object.entries(FILTER_FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                      </select>
                      <select className="fr-select fr-op" value={r.op} onChange={e => {
                        const op = e.target.value;
                        const patch = { op };
                        if (NO_VALUE_OPS.includes(op)) patch.value = '';
                        else if (MULTI_OPS.includes(op)) patch.value = Array.isArray(r.value) ? r.value : [];
                        else if (Array.isArray(r.value)) patch.value = '';
                        updateRule(r.id, patch);
                      }}>
                        {FILTER_OPS[type].map(([op, label]) => <option key={op} value={op}>{label}</option>)}
                      </select>
                      {needsValue && type === 'select' && !MULTI_OPS.includes(r.op) && (
                        <select className="fr-select fr-value" value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })}>
                          <option value="">Select…</option>
                          {fieldOptions(r.field).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      )}
                      {needsValue && type === 'select' && MULTI_OPS.includes(r.op) && (
                        <span className="fr-multi-wrap">
                          <button type="button" className="fr-select fr-multi-btn" onClick={() => setOpenMulti(openMulti === r.id ? null : r.id)}>
                            {Array.isArray(r.value) && r.value.length
                              ? `${r.value.length} selected`
                              : 'Select…'}
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                          </button>
                          {openMulti === r.id && (
                            <div className="fr-multi-pop">
                              {fieldOptions(r.field).map(o => (
                                <label key={o.v} className="tt-popover-row">
                                  <input
                                    type="checkbox"
                                    checked={Array.isArray(r.value) && r.value.includes(o.v)}
                                    onChange={() => {
                                      const cur = Array.isArray(r.value) ? r.value : [];
                                      updateRule(r.id, { value: cur.includes(o.v) ? cur.filter(x => x !== o.v) : [...cur, o.v] });
                                    }}
                                  />
                                  <span>{o.l}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </span>
                      )}
                      {needsValue && type === 'date' && (
                        <span className="fr-date-wrap">
                          <select
                            className="fr-select"
                            value={String(r.value).startsWith('@') ? r.value : '__custom__'}
                            onChange={e => updateRule(r.id, { value: e.target.value === '__custom__' ? '' : e.target.value })}
                          >
                            {REL_DATES.map(([tok, label]) => <option key={tok} value={tok}>{label}</option>)}
                            <option value="__custom__">Custom date…</option>
                          </select>
                          {!String(r.value).startsWith('@') && (
                            <input className="fr-select" type="date" value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })} />
                          )}
                        </span>
                      )}
                      {needsValue && type === 'text' && (
                        <input className="fr-select fr-value" type="text" placeholder="Type a value…" value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })} />
                      )}
                      {needsValue && type === 'number' && (
                        <input className="fr-select fr-value" type="number" placeholder="0" value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })} />
                      )}
                      {needsValue && type === 'multiselect' && (
                        <select className="fr-select fr-value" value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })}>
                          <option value="">Select…</option>
                          {fieldOptions(r.field).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      )}
                      <button className="btn-icon fr-remove" onClick={() => removeRule(r.id)} title="Remove filter">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  );
                })}

                <button className="fr-add" onClick={() => addRule()}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add filter
                </button>

                <div className="filter-panel-footer">
                  <button className="btn btn-ghost btn-sm" onClick={clearFilters} disabled={filterRules.length === 0}>Clear all</button>
                  <span className="filter-panel-scope">
                    {isPersonalSpace
                      ? 'Saved to this view (only you)'
                      : `Saved to the "${activeView.name}" view for everyone`}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="pg-chips">
          {activeFilters.map(f => (
            <span key={f.key} className="filter-chip">
              <span className="filter-chip-label">{f.label}:</span>
              <span className="filter-chip-value">{f.value}</span>
              <button className="filter-chip-close" onClick={f.clear} title={`Remove ${f.label} filter`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </span>
          ))}
          <button className="pg-chips-clear" onClick={clearFilters}>Clear all</button>
        </div>
      )}

      {/* Click outside to close popovers */}
      {openFilter && <div className="filter-overlay" onClick={() => setOpenFilter(null)} />}
      {colMenu && <div className="filter-overlay" onClick={() => setColMenu(null)} />}

      <div className="tasks-content">
        {/* ─── Kanban board ─── */}
        {viewType === 'board' && (
          <div className="board">
            {STATUSES.map((status) => {
              const statusTasks = getTasksByStatus(status);
              return (
                <div className="board-column" key={status}
                  onDragOver={(e) => handleDragOver(e, status)}
                  onDrop={(e) => handleDrop(e, status)}
                >
                  <div className="kb-head">
                    <span className="kb-bar" style={{ background: STATUS_COLOR[status] }} />
                    <h3>{COLUMN_LABEL[status]}</h3>
                    <span className="kb-count">{statusTasks.length}</span>
                    <div className="kb-actions">
                      <button className="btn-icon" title="Add task" onClick={() => handleCreateNew(status)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                      <button className="btn-icon" title="Column options" onClick={() => setColMenu(colMenu === status ? null : status)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
                      </button>
                      {colMenu === status && (
                        <div className="kb-menu animate-in">
                          <button onClick={() => { setColMenu(null); handleCreateNew(status); }}>Add task here</button>
                          <button onClick={() => { setColMenu(null); applyColumnFilter('status', status); }}>Show only this status</button>
                          {filterRules.some(r => r.field === 'status') && (
                            <button onClick={() => { setColMenu(null); applyColumnFilter('status', ''); }}>Clear status filter</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="kb-cards">
                    {statusTasks.map((task, i) => renderCard(task, i))}
                    {statusTasks.length === 0 && <div className="board-empty"><p>Drop tasks here</p></div>}
                  </div>
                  <button className="kb-add" onClick={() => handleCreateNew(status)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add new
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── Calendar ─── */}
        {viewType === 'calendar' && (
          <CalendarView tasks={filteredTasks} statusColor={STATUS_COLOR} onOpen={setSelectedTask} />
        )}

        {/* ─── Timeline ─── */}
        {viewType === 'timeline' && (
          <TimelineView tasks={filteredTasks} teamMembers={teamMembers} statusColor={STATUS_COLOR} onOpen={setSelectedTask} />
        )}

        {/* ─── List ─── */}
        {viewType === 'list' && (
          <div className="list-view">
            {/* Bulk Action Bar */}
            {selectedTasksIds.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 16 }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{selectedTasksIds.length} tasks selected</span>
                <div style={{ flex: 1 }} />
                <select
                  className="input"
                  style={{ width: 200, padding: '6px 12px', fontSize: '0.8rem' }}
                  onChange={e => handleBulkChangeSprint(e.target.value)}
                  value=""
                >
                  <option value="" disabled>Change Sprint...</option>
                  <option value="None">None</option>
                  {sprints.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedTasksIds([])}>Cancel</button>
              </div>
            )}

            {filteredTasks.length === 0 ? (
              <div className="empty-state"><p>No tasks match your filters.</p></div>
            ) : (
              <>
                {/* Table Header */}
                <div className="list-item" style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--text-muted)' }}>
                  <div className="list-item-left" style={{ gap: 16 }}>
                    <input type="checkbox" onChange={handleSelectAll} checked={selectedTasksIds.length === filteredTasks.length && filteredTasks.length > 0} />
                    <span className="list-item-title" style={{ color: 'var(--text-muted)' }}>Task Name</span>
                  </div>
                  <div className="list-item-right" style={{ paddingRight: 16 }}>
                    <span style={{ width: 120 }}>Assignee</span>
                    <span style={{ width: 80, textAlign: 'right' }}>Time</span>
                    <span style={{ width: 100, textAlign: 'right' }}>Due Date</span>
                    <span style={{ width: 100, textAlign: 'right' }}>Status</span>
                  </div>
                </div>

                {filteredTasks.map((task, i) => {
                  const taskId = task.id || task._id;
                  return (
                  <div className="list-item animate-in" key={taskId} style={{ animationDelay: `${i * 0.03}s` }} onClick={() => setSelectedTask(task)}>
                    <div className="list-item-left" style={{ gap: 16 }}>
                      <input type="checkbox" onClick={e => e.stopPropagation()} onChange={e => handleSelectTask(e, taskId)} checked={selectedTasksIds.includes(taskId)} />
                      <div className={`list-dot ${STATUS_DOT[task.status] || 'dot-notstarted'}`} style={{ marginLeft: 0 }} />
                      <span className="list-item-title">{task.title}</span>
                      {task.projectId && <span className="list-item-project">{getProjectName(task.projectId)}</span>}
                      {task.attachments?.length > 0 && (
                        <span className="list-item-attachments" title={`${task.attachments.length} attachment${task.attachments.length > 1 ? 's' : ''}`}>
                          <FileTypeIcon name={task.attachments[0].name} size={14} />
                          {task.attachments.length > 1 && task.attachments.length}
                        </span>
                      )}
                    </div>
                    <div className="list-item-right">
                      <span className="list-item-assignee" style={{ width: 120 }}>
                        {task.assignee ? (
                          <>
                            <div className="task-card-avatar" style={{width: 20, height: 20, fontSize: 10, marginRight: 6, display: 'inline-flex', verticalAlign: 'middle'}}>{renderAvatar(task.assignee)}</div>
                            {task.assignee}
                          </>
                        ) : 'Unassigned'}
                      </span>
                      <span className="list-item-hours" style={{ width: 80, textAlign: 'right' }}>
                        {(task.estimatedHours > 0 || task.actualHours > 0) ? `${task.actualHours || 0}/${task.estimatedHours || 0}h` : ''}
                      </span>
                      <span className="list-item-date" style={{ width: 100, textAlign: 'right' }}>
                        {task.dueDate ? formatDate(task.dueDate) : ''}
                      </span>
                      <span style={{ width: 100, textAlign: 'right' }}>
                        <span className={`badge ${STATUS_BADGE[task.status] || 'badge-notstarted'}`}>{task.status}</span>
                      </span>
                    </div>
                  </div>
                )})}
              </>
            )}
          </div>
        )}

        {/* ─── Table ─── */}
        {viewType === 'table' && selectedTasksIds.length > 0 && (
          <div className="tt-bulkbar">
            <span className="tt-bulkbar-count">{selectedTasksIds.length} selected</span>
            <select
              className="fr-select"
              defaultValue=""
              onChange={(e) => { if (e.target.value !== '') { handleBulkChangeSprint(e.target.value); e.target.value = ''; } }}
            >
              <option value="" disabled>Move to sprint…</option>
              <option value="None">No sprint</option>
              {sprints.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
            <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>Delete</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedTasksIds([])}>Clear</button>
          </div>
        )}

        {viewType === 'table' && (
          <TaskTable
            key={activeView.id}
            tasks={filteredTasks}
            projects={projects}
            sprints={sprints}
            teamMembers={teamMembers}
            statuses={STATUSES}
            priorities={PRIORITIES}
            priorityColor={PRIORITY_COLOR}
            canEditTask={canEditTask}
            canChangeStatusTo={canChangeStatusTo}
            onStatusChange={handleStatusChange}
            onInlineUpdate={handleInlineUpdate}
            onDelete={handleDelete}
            onOpen={setSelectedTask}
            onFilter={applyColumnFilter}
            formatDate={formatDate}
            renderAvatar={renderAvatar}
            taskProgress={taskProgress}
            sorts={activeView.sorts || []}
            groupBy={activeView.groupBy || ''}
            hidden={activeView.hiddenColumns || []}
            columnOrder={activeView.columnOrder || []}
            columnWidths={activeView.columnWidths || null}
            calcs={activeView.calcs || null}
            onPrefsChange={patchActiveView}
            customProps={customProps}
            onCreateProperty={handleCreateProperty}
            onDeleteProperty={isAdminOrOwner ? handleDeleteProperty : null}
            onCreateTask={handleInlineCreate}
            selectedIds={selectedTasksIds}
            onToggleSelect={(id, checked) => setSelectedTasksIds(prev => checked ? [...prev, id] : prev.filter(x => x !== id))}
            onToggleSelectAll={(checked) => setSelectedTasksIds(checked ? filteredTasks.map(t => t.id) : [])}
          />
        )}
      </div>

      {/* ─── Slide-over task panel ─── */}
      {panelTask && (
        <TaskPanel
          key={panelTask.id}
          task={panelTask}
          allTasks={tasks}
          teamMembers={teamMembers}
          projects={projects}
          sprints={sprints}
          statuses={STATUSES}
          priorities={PRIORITIES}
          priorityColor={PRIORITY_COLOR}
          currentUser={user}
          canEdit={canEditTask(panelTask)}
          canChangeStatusTo={(s) => canChangeStatusTo(panelTask, s)}
          onClose={() => { setSelectedTask(null); fetchTasks(); }}
          onOpenFull={() => { setFullTask(panelTask); setSelectedTask(null); }}
          onUpdated={fetchTasks}
          onDeleted={() => { setSelectedTask(null); fetchTasks(); }}
        />
      )}
    </div>
  );
}
