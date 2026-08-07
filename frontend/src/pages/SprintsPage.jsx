import { useState, useEffect } from 'react';
import {
  getSprints, createSprint, updateSprint, deleteSprint,
  startSprint, completeSprint, getSprint,
  getTasks, updateTask, addTaskToSprint, removeTaskFromSprint,
  getProjects, getTeam, syncNotionSprints,
} from '../api';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import ViewTabs from '../components/ViewTabs';
import './SprintsPage.css';

const STATUSES = ['Not Yet Started', 'In Progress', 'In Review', 'Completed', 'Rejected'];

const STATUS_COLOR = {
  'Not Yet Started': 'var(--text-muted)',
  'In Progress':     'var(--accent-blue, #2383e2)',
  'In Review':       '#d9730d',
  'Completed':       'var(--accent-green)',
  'Rejected':        'var(--accent-red, #d44c47)',
};

const fmt = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const daysLeft = (end) => {
  if (!end) return null;
  const diff = Math.ceil((new Date(end) - new Date()) / 86400000);
  return diff;
};

export default function SprintsPage() {
  const { user } = useAuth();
  const { activeTeamspaceId } = useTeamspace();
  const isAdmin = user?.role === 'Admin' || user?.role === 'Team Owner';

  const [sprints, setSprints]     = useState([]);
  const [projects, setProjects]   = useState([]);
  const [allTasks, setAllTasks]   = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [activeSprint, setActiveSprint] = useState(null);
  const [sprintTasks, setSprintTasks]   = useState([]);
  
  const [views, setViews] = useState(() => {
    const saved = localStorage.getItem('sprints_views');
    return saved ? JSON.parse(saved) : [
      { id: 'v1', type: 'list', name: 'List' },
      { id: 'v2', type: 'cards', name: 'Cards' },
      { id: 'v3', type: 'board', name: 'Board' }
    ];
  });
  const [activeViewId, setActiveViewId] = useState(views[0]?.id || 'v1');
  const viewType = views.find(v => v.id === activeViewId)?.type || 'list';

  // Sub-view for tasks inside a sprint
  const [sprintTaskViews, setSprintTaskViews] = useState(() => {
    const saved = localStorage.getItem('sprint_task_views');
    return saved ? JSON.parse(saved) : [
      { id: 'sv1', type: 'board', name: 'Board' },
      { id: 'sv2', type: 'table', name: 'Table' }
    ];
  });
  const [activeSprintTaskViewId, setActiveSprintTaskViewId] = useState(sprintTaskViews[0]?.id || 'sv1');
  const sprintTaskViewType = sprintTaskViews.find(v => v.id === activeSprintTaskViewId)?.type || 'board';

  useEffect(() => {
    localStorage.setItem('sprints_views', JSON.stringify(views));
  }, [views]);

  useEffect(() => {
    localStorage.setItem('sprint_task_views', JSON.stringify(sprintTaskViews));
  }, [sprintTaskViews]);

  const [showCreate, setShowCreate]   = useState(false);
  const [showNotionSync, setShowNotionSync] = useState(false);
  const [notionForm, setNotionForm] = useState({ token: '', databaseId: '' });
  const [notionSyncing, setNotionSyncing] = useState(false);
  const [showComplete, setShowComplete] = useState(null);
  const [rolloverTarget, setRolloverTarget] = useState('');
  const [showAddTask, setShowAddTask]   = useState(false);

  const [form, setForm] = useState({ name: '', goal: '', startDate: '', endDate: '', projectId: '' });
  const [saving, setSaving] = useState(false);
  const [editSprint, setEditSprint] = useState(null);

  useEffect(() => {
    fetchAll();
  }, [activeTeamspaceId]);

  const fetchAll = async () => {
    try {
      const [sr, pr, tr, teamRes] = await Promise.all([
        getSprints(activeTeamspaceId), 
        getProjects(activeTeamspaceId), 
        getTasks(activeTeamspaceId), 
        getTeam()
      ]);
      setSprints(sr.data);
      setProjects(pr.data);
      setAllTasks(tr.data);
      setTeamMembers(teamRes.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const openSprint = async (sprint) => {
    try {
      const res = await getSprint(sprint._id);
      setActiveSprint(res.data);
      setSprintTasks(res.data.tasks || []);
    } catch (e) { console.error(e); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, createdBy: user?.name, teamspaceId: activeTeamspaceId };
      if (!payload.startDate) delete payload.startDate;
      if (!payload.endDate) delete payload.endDate;
      if (!payload.projectId) delete payload.projectId;

      await createSprint(payload);
      setForm({ name: '', goal: '', startDate: '', endDate: '', projectId: '' });
      setShowCreate(false);
      await fetchAll();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const handleStart = async (sprint) => {
    try {
      await startSprint(sprint._id);
      await fetchAll();
      if (activeSprint?._id === sprint._id) {
        openSprint({ _id: sprint._id });
      }
    } catch (e) { console.error(e); }
  };

  const handleComplete = async () => {
    if (!showComplete) return;
    try {
      await completeSprint(showComplete._id, rolloverTarget || undefined);
      setShowComplete(null);
      setRolloverTarget('');
      setActiveSprint(null);
      await fetchAll();
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (sprint) => {
    if (!confirm(`Delete "${sprint.name}"? Tasks will become unassigned.`)) return;
    try {
      await deleteSprint(sprint._id);
      if (activeSprint?._id === sprint._id) setActiveSprint(null);
      await fetchAll();
    } catch (e) { console.error(e); }
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await updateTask(taskId, { status: newStatus });
      setSprintTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    } catch (e) { console.error(e); }
  };

  const handleAddTask = async (taskId) => {
    if (!activeSprint || !taskId) return;
    try {
      await addTaskToSprint(activeSprint._id, taskId);
      const res = await getSprint(activeSprint._id);
      setActiveSprint(res.data);
      setSprintTasks(res.data.tasks || []);
      await fetchAll();
    } catch (e) { console.error(e); }
    setShowAddTask(false);
  };

  const handleRemoveTask = async (taskId) => {
    if (!activeSprint) return;
    try {
      await removeTaskFromSprint(activeSprint._id, taskId);
      setSprintTasks(prev => prev.filter(t => t.id !== taskId));
      await fetchAll();
    } catch (e) { console.error(e); }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: editSprint.name,
        goal: editSprint.goal,
        startDate: editSprint.startDate,
        endDate: editSprint.endDate,
      };
      if (!payload.startDate) delete payload.startDate;
      if (!payload.endDate) delete payload.endDate;

      await updateSprint(editSprint._id, payload);
      setEditSprint(null);
      await fetchAll();
      if (activeSprint?._id === editSprint._id) openSprint({ _id: editSprint._id });
    } catch (e) { console.error(e); }
  };

  const handleNotionSync = async (e) => {
    e.preventDefault();
    if (!notionForm.token || !notionForm.databaseId) return;
    setNotionSyncing(true);
    try {
      const res = await syncNotionSprints({ ...notionForm, teamspaceId: activeTeamspaceId });
      alert(res.data.message);
      setShowNotionSync(false);
      await fetchAll();
    } catch (e) {
      alert("Failed to sync: " + (e.response?.data?.error || e.message));
    } finally {
      setNotionSyncing(false);
    }
  };

  const handleAddView = (type, label) => {
    const newId = `v${Date.now()}`;
    setViews(prev => [...prev, { id: newId, type, name: label }]);
    setActiveViewId(newId);
  };

  const handleAddSprintTaskView = (type, label) => {
    const newId = `sv${Date.now()}`;
    setSprintTaskViews(prev => [...prev, { id: newId, type, name: label }]);
    setActiveSprintTaskViewId(newId);
  };

  const unassignedTasks = allTasks.filter(t => {
    if (t.sprintId || t.parentId) return false;
    if (activeSprint?.projectId && t.projectId !== activeSprint.projectId) return false;
    return true;
  });

  const progress = activeSprint
    ? Math.round(((activeSprint.doneCount || 0) / (activeSprint.taskCount || 1)) * 100)
    : 0;

  const boardByStatus = STATUSES.reduce((acc, s) => {
    acc[s] = sprintTasks.filter(t => t.status === s);
    return acc;
  }, {});

  const renderAvatar = (name) => {
    const member = teamMembers.find(m => m.name === name);
    if (member?.profilePictureUrl) {
      return <img src={member.profilePictureUrl} alt={name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />;
    }
    return name?.charAt(0).toUpperCase() || '?';
  };

  if (loading) {
    return <div className="sprint-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;
  }

  if (activeSprint) {
    const dl = daysLeft(activeSprint.endDate);
    const progress = activeSprint.taskCount > 0 ? Math.round((activeSprint.doneCount / activeSprint.taskCount) * 100) : 0;
    return (
      <div className="sprints-page">
      <div className="sprint-detail-header" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setActiveSprint(null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15,18 9,12 15,6"/></svg>
            Back
          </button>
          <ViewTabs 
            views={sprintTaskViews} 
            activeViewId={activeSprintTaskViewId} 
            onChangeView={setActiveSprintTaskViewId} 
            onAddView={handleAddSprintTaskView} 
          />
        </div>
      </div>
          <div className="sprint-detail-title">
            <span className={`sprint-status-dot dot-${activeSprint.status}`} />
            <h2>{activeSprint.name}</h2>
            <span className={`sprint-badge sprint-badge-${activeSprint.status}`}>{activeSprint.status}</span>
          </div>
          <div className="sprint-detail-actions">
            {isAdmin && activeSprint.status === 'planned' && (
              <button className="btn btn-primary btn-sm" onClick={() => handleStart(activeSprint)}>▶ Start Sprint</button>
            )}
            {isAdmin && activeSprint.status === 'active' && (
              <button className="btn btn-sm" style={{ background: 'var(--accent-green)', color: '#fff' }}
                onClick={() => setShowComplete(activeSprint)}>✓ Complete Sprint</button>
            )}
            {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => setEditSprint({ ...activeSprint })}>Edit</button>}
            {isAdmin && <button className="btn btn-ghost btn-sm sprint-delete" onClick={() => handleDelete(activeSprint)}>Delete</button>}
          </div>

        <div className="sprint-meta-bar">
          {activeSprint.goal && <p className="sprint-goal">🎯 {activeSprint.goal}</p>}
          <div className="sprint-meta-chips">
            <span className="sprint-meta-chip">📅 {fmt(activeSprint.startDate)} → {fmt(activeSprint.endDate)}</span>
            {dl !== null && activeSprint.status === 'active' && (
              <span className={`sprint-meta-chip ${dl < 3 ? 'chip-danger' : dl < 7 ? 'chip-warn' : ''}`}>
                {dl > 0 ? `${dl}d remaining` : dl === 0 ? 'Due today' : `${Math.abs(dl)}d overdue`}
              </span>
            )}
            <span className="sprint-meta-chip">{activeSprint.taskCount || 0} tasks</span>
          </div>
        </div>

        {activeSprint.status !== 'planned' && (
          <div className="sprint-progress-wrap">
            <div className="sprint-progress-label">
              <span>Progress</span>
              <span>{activeSprint.doneCount || 0}/{activeSprint.taskCount || 0} done · {progress}%</span>
            </div>
            <div className="sprint-progress-track">
              <div className="sprint-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {sprintTaskViewType === 'board' && (
          <div className="sprint-board animate-in">
            {STATUSES.map(status => (
              <div className="sprint-col" key={status}>
                <div className="sprint-col-header">
                  <span className="sprint-col-dot" style={{ background: STATUS_COLOR[status] }} />
                  <span className="sprint-col-title">{status}</span>
                  <span className="sprint-col-count">{boardByStatus[status].length}</span>
                </div>
                <div className="sprint-col-cards">
                  {boardByStatus[status].map(task => (
                    <div className="sprint-task-card" key={task.id}>
                      <div className="sprint-task-top">
                        <span className="sprint-task-title">{task.title}</span>
                        {isAdmin && (
                          <button className="btn-icon sprint-task-remove" onClick={() => handleRemoveTask(task.id)} title="Remove from sprint">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        )}
                      </div>
                      {task.assignee && (
                        <div className="sprint-task-assignee" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                          <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600 }}>
                            {renderAvatar(task.assignee)}
                          </div>
                          {task.assignee}
                        </div>
                      )}
                      {task.priority && (
                        <span className={`sprint-priority-badge priority-${task.priority?.toLowerCase()}`}>{task.priority}</span>
                      )}
                      <select
                        className="sprint-task-status"
                        value={task.status}
                        onChange={e => handleStatusChange(task.id, e.target.value)}
                        style={{ borderColor: STATUS_COLOR[task.status] }}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  ))}
                  {boardByStatus[status].length === 0 && (
                    <div className="sprint-col-empty">Empty</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {sprintTaskViewType === 'table' && (
          <div className="table-wrapper animate-in">
            <table className="task-table">
              <thead>
                <tr><th>Title</th><th>Status</th><th>Assignee</th><th>Priority</th><th></th></tr>
              </thead>
              <tbody>
                {sprintTasks.map(task => (
                  <tr key={task.id}>
                    <td>{task.title}</td>
                    <td>
                      <select className="table-status-select" value={task.status} onChange={e => handleStatusChange(task.id, e.target.value)}>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>{task.assignee || '—'}</td>
                    <td>{task.priority || '—'}</td>
                    <td>
                      {isAdmin && (
                        <button className="btn-icon" onClick={() => handleRemoveTask(task.id)} title="Remove">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isAdmin && (
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAddTask(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add task to sprint
            </button>
          </div>
        )}
        {/* Add Task Modal */}
        {showAddTask && (
          <div className="modal-overlay" onClick={() => setShowAddTask(false)}>
            <div className="modal animate-in" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Add Task to Sprint</h2>
                <button className="btn-icon" onClick={() => setShowAddTask(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="add-task-list">
                {unassignedTasks.length === 0 && (
                  <p className="add-task-empty">No unassigned tasks available.</p>
                )}
                {unassignedTasks.map(t => (
                  <div key={t.id} className="add-task-item" onClick={() => handleAddTask(t.id)}>
                    <span className="add-task-dot" style={{ background: STATUS_COLOR[t.status] }} />
                    <span className="add-task-title">{t.title}</span>
                    {t.assignee && (
                      <span className="add-task-assignee" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8 }}>
                          {renderAvatar(t.assignee)}
                        </div>
                        {t.assignee}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Edit Sprint Modal */}
        {editSprint && (
          <div className="modal-overlay" onClick={() => setEditSprint(null)}>
            <div className="modal animate-in" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Edit Sprint</h2>
                <button className="btn-icon" onClick={() => setEditSprint(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <form onSubmit={handleSaveEdit} className="modal-form">
                <div className="form-field">
                  <label className="label">Sprint Name</label>
                  <input className="input" value={editSprint.name} onChange={e => setEditSprint(p => ({ ...p, name: e.target.value }))} required />
                </div>
                <div className="form-field">
                  <label className="label">Goal</label>
                  <input className="input" value={editSprint.goal} onChange={e => setEditSprint(p => ({ ...p, goal: e.target.value }))} placeholder="What do you want to achieve?" />
                </div>
                <div className="modal-row">
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="label">Start Date</label>
                    <input className="input" type="date" value={editSprint.startDate?.split?.('T')[0] || ''} onChange={e => setEditSprint(p => ({ ...p, startDate: e.target.value }))} />
                  </div>
                  <div className="form-field" style={{ flex: 1 }}>
                    <label className="label">End Date</label>
                    <input className="input" type="date" value={editSprint.endDate?.split?.('T')[0] || ''} onChange={e => setEditSprint(p => ({ ...p, endDate: e.target.value }))} />
                  </div>
                </div>
                <div className="modal-actions">
                  <div style={{ flex: 1 }} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditSprint(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm">Save</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Complete Sprint Modal */}
        {showComplete && (
          <div className="modal-overlay" onClick={() => setShowComplete(null)}>
            <div className="modal animate-in" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Complete Sprint</h2>
                <button className="btn-icon" onClick={() => setShowComplete(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="modal-form">
                <p className="complete-msg">
                  Incomplete tasks will be moved to another sprint or unassigned.
                </p>
                <div className="form-field">
                  <label className="label">Roll over incomplete tasks to</label>
                  <select className="input" value={rolloverTarget} onChange={e => setRolloverTarget(e.target.value)}>
                    <option value="">Unassign (backlog)</option>
                    {planned.filter(s => s._id !== showComplete._id).map(s => (
                      <option key={s._id} value={s._id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="modal-actions">
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowComplete(null)}>Cancel</button>
                  <button className="btn btn-sm" style={{ background: 'var(--accent-green)', color: '#fff' }} onClick={handleComplete}>
                    ✓ Complete Sprint
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Sprint List View ───────────────────────────────────
  return (
    <div className="sprints-page">
      {/* Toolbar */}
      <div className="sprint-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Design Sprints
          </h1>
          <ViewTabs 
            views={views} 
            activeViewId={activeViewId} 
            onChangeView={setActiveViewId} 
            onAddView={handleAddView} 
          />
        </div>
        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            New Sprint
          </button>
        )}
      </div>



      {sprints.length === 0 && (
        <div className="sprint-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
          <p>No sprints yet. Create your first sprint to get started.</p>
        </div>
      )}

      {viewType === 'list' && (
        <div className="sprint-list animate-in">
          {sprints.map(s => (
            <div className="sprint-card-list-item" key={s._id} onClick={() => setActiveSprint(s)}>
              <div className="sprint-item-left">
                <span className={`sprint-status-dot dot-${s.status}`} />
                <span className="sprint-item-name">{s.name}</span>
                <span className="sprint-item-date">{new Date(s.startDate).toLocaleDateString()}</span>
              </div>
              <div className="sprint-item-center">
                <div className="sprint-mini-progress">
                  <div className="sprint-mini-fill" style={{ width: `${Math.round((s.doneCount / s.taskCount) * 100) || 0}%` }} />
                </div>
                <span className="sprint-item-count">{s.doneCount || 0}/{s.taskCount || 0} tasks</span>
              </div>
              <div className="sprint-item-right">
                <span className={`sprint-badge sprint-badge-${s.status}`}>{s.status}</span>
              </div>
            </div>
          ))}
          {sprints.length === 0 && <div className="sprint-empty">No sprints found.</div>}
        </div>
      )}

      {viewType === 'cards' && (
        <div className="sprints-gallery animate-in">
          {sprints.map(s => {
            const progress = s.taskCount > 0 ? (s.doneCount / s.taskCount) * 100 : 0;
            return (
              <div key={s._id} className="sprint-card" onClick={() => openSprint(s)}>
                <div className="sprint-card-header">
                  <div className="sprint-card-icon">⚡</div>
                  <h3 className="sprint-card-title">{s.name}</h3>
                </div>
                <div className="sprint-card-meta">
                  <span className={`sprint-status-dot dot-${s.status}`} />
                  <span className="sprint-status-text">{s.status === 'active' ? 'Current' : s.status === 'planned' ? 'Future' : 'Past'}</span>
                </div>
                {s.goal && <p className="sprint-card-goal">{s.goal}</p>}
                <div className="sprint-card-footer">
                  <div className="sprint-progress-bar">
                    <div className="sprint-progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="sprint-progress-text">
                    <span>{s.doneCount || 0}/{s.taskCount || 0} tasks</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sprints.length > 0 && viewType === 'board' && (
        <div className="sprints-board animate-in">
          {['planned', 'active', 'completed'].map(groupStatus => {
            const groupSprints = sprints.filter(s => s.status === groupStatus);
            const groupLabel = groupStatus === 'active' ? 'Current' : groupStatus === 'planned' ? 'Future' : 'Past';
            return (
              <div className="sprint-board-group" key={groupStatus}>
                <div className="sprint-group-header">
                  <span className={`sprint-status-dot dot-${groupStatus}`} />
                  <h3>{groupLabel}</h3>
                  <span className="sprint-group-count">{groupSprints.length}</span>
                </div>
                <div className="sprint-group-items">
                  {groupSprints.map(s => {
                    const progress = s.taskCount > 0 ? (s.doneCount / s.taskCount) * 100 : 0;
                    return (
                      <div key={s._id} className="sprint-board-item" onClick={() => openSprint(s)}>
                        <h4 className="sprint-item-name">{s.name}</h4>
                        <div className="sprint-item-meta">
                          <span>{fmt(s.startDate)} - {fmt(s.endDate)}</span>
                        </div>
                        <div className="sprint-item-progress">
                          <div className="sprint-progress-bar" style={{ height: 4 }}>
                            <div className="sprint-progress-fill" style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {groupSprints.length === 0 && <div className="sprint-item-empty">No sprints</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sprints.length > 0 && viewType === 'timeline' && (
        <SprintsTimeline sprints={sprints} onOpen={openSprint} />
      )}

      {/* Notion Sync Modal */}
      {showNotionSync && (
        <div className="modal-overlay" onClick={() => setShowNotionSync(false)}>
          <div className="modal animate-in" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Sync with Notion</h2>
              <button className="btn-icon" onClick={() => setShowNotionSync(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleNotionSync} className="modal-form">
              <div className="form-field">
                <label className="label">Notion Integration Token *</label>
                <input className="input" placeholder="secret_..." value={notionForm.token}
                  onChange={e => setNotionForm(p => ({ ...p, token: e.target.value }))} required autoFocus />
                <p style={{fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4}}>Create an integration at <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">notion.so/my-integrations</a></p>
              </div>
              <div className="form-field">
                <label className="label">Database ID *</label>
                <input className="input" placeholder="e.g. 59b5..." value={notionForm.databaseId}
                  onChange={e => setNotionForm(p => ({ ...p, databaseId: e.target.value }))} required />
              </div>
              <div className="modal-footer" style={{ marginTop: 24 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowNotionSync(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={notionSyncing}>
                  {notionSyncing ? 'Syncing...' : 'Start Sync'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Sprint Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal animate-in" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Sprint</h2>
              <button className="btn-icon" onClick={() => setShowCreate(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="modal-form">
              <div className="form-field">
                <label className="label">Sprint Name *</label>
                <input className="input" placeholder="e.g. Sprint 4 — Design Polish" value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Sprint Goal</label>
                <input className="input" placeholder="What's the goal for this sprint?" value={form.goal}
                  onChange={e => setForm(p => ({ ...p, goal: e.target.value }))} />
              </div>
              <div className="modal-row">
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="label">Start Date</label>
                  <input className="input" type="date" value={form.startDate}
                    onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="label">End Date</label>
                  <input className="input" type="date" value={form.endDate}
                    onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} />
                </div>
              </div>
              <div className="form-field">
                <label className="label">Project (optional)</label>
                <select className="input" value={form.projectId} onChange={e => setForm(p => ({ ...p, projectId: e.target.value }))}>
                  <option value="">All projects</option>
                  {projects.map(p => <option key={p._id} value={p._id}>{p.icon} {p.name}</option>)}
                </select>
              </div>
              <div className="modal-actions">
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                  {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Create Sprint'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Timeline View Component ─────────────────────────────────
function SprintsTimeline({ sprints, onOpen }) {
  // Determine timeline bounds
  let minDate = new Date();
  let maxDate = new Date();
  minDate.setMonth(minDate.getMonth() - 1);
  maxDate.setMonth(maxDate.getMonth() + 2);

  const sprintsWithDates = sprints.filter(s => s.startDate && s.endDate).map(s => ({
    ...s,
    start: new Date(s.startDate),
    end: new Date(s.endDate)
  }));

  if (sprintsWithDates.length > 0) {
    const startDates = sprintsWithDates.map(s => s.start).sort((a,b)=>a-b);
    const endDates = sprintsWithDates.map(s => s.end).sort((a,b)=>b-a);
    if (startDates[0] < minDate) minDate = new Date(startDates[0]);
    if (endDates[0] > maxDate) maxDate = new Date(endDates[0]);
  }

  // Snap to month boundaries
  minDate.setDate(1);
  maxDate.setMonth(maxDate.getMonth() + 1);
  maxDate.setDate(0);
  minDate.setHours(0,0,0,0);
  maxDate.setHours(23,59,59,999);

  const totalDays = Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
  const dayWidth = 32;

  const days = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(minDate);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const months = [];
  let currentMonth = -1;
  days.forEach(d => {
    if (d.getMonth() !== currentMonth) {
      months.push({ label: d.toLocaleString('default', { month: 'long', year: 'numeric' }), days: 1 });
      currentMonth = d.getMonth();
    } else {
      months[months.length - 1].days++;
    }
  });

  return (
    <div className="sprints-timeline-wrapper">
      {/* Left List */}
      <div className="timeline-left-panel">
        <div className="timeline-header timeline-left-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: 6}}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          Sprint name
        </div>
        <div>
          {sprints.map(s => (
            <div key={s._id} className="timeline-row timeline-left-row timeline-row-hover" onClick={() => onOpen(s)}>
              <span style={{flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{s.name}</span>
              <span className={`sprint-status-dot dot-${s.status}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Gantt Area */}
      <div className="timeline-right-panel">
        <div className="timeline-header" style={{ minWidth: totalDays * dayWidth, flexDirection: 'column' }}>
          {/* Months */}
          <div style={{ display: 'flex', height: 30, borderBottom: '1px solid var(--border)' }}>
            {months.map((m, i) => (
              <div key={i} style={{ width: m.days * dayWidth, padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', borderRight: '1px solid var(--border)' }}>
                {m.label}
              </div>
            ))}
          </div>
          {/* Days */}
          <div style={{ display: 'flex', height: 30 }}>
            {days.map((d, i) => (
              <div key={i} style={{ width: dayWidth, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', borderRight: '1px solid var(--border)', background: (d.getDay()===0||d.getDay()===6) ? 'var(--bg-hover)' : 'transparent' }}>
                {d.getDate()}
              </div>
            ))}
          </div>
        </div>

        {/* Grid and Bars */}
        <div style={{ position: 'relative', minWidth: totalDays * dayWidth }}>
          {/* Background grid lines */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', pointerEvents: 'none', zIndex: 1 }}>
             {days.map((d, i) => (
              <div key={i} style={{ width: dayWidth, borderRight: '1px dashed var(--border-light)', background: (d.getDay()===0||d.getDay()===6) ? 'var(--bg-hover)' : 'transparent' }} />
            ))}
          </div>

          <div style={{ position: 'relative', zIndex: 2 }}>
            {sprints.map(s => {
              const hasDates = s.startDate && s.endDate;
              let left = 0, width = 0;
              if (hasDates) {
                const start = new Date(s.startDate);
                const end = new Date(s.endDate);
                start.setHours(0,0,0,0);
                end.setHours(0,0,0,0);
                const leftDays = Math.round((start - minDate) / (1000 * 60 * 60 * 24));
                const widthDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
                left = leftDays * dayWidth;
                width = widthDays * dayWidth;
              }

              let bg = 'rgba(150,150,150,0.15)';
              let border = 'var(--border)';
              let color = 'var(--text-muted)';
              
              if (s.status === 'active') {
                bg = 'rgba(0,184,148,0.2)';
                border = 'var(--accent-green)';
                color = 'var(--accent-green)';
              } else if (s.status === 'planned') {
                bg = 'rgba(116,185,255,0.2)';
                border = 'var(--accent-blue)';
                color = 'var(--accent-blue)';
              }

              return (
                <div key={s._id} className="timeline-row timeline-gantt-row timeline-row-hover">
                  {hasDates && (
                    <div 
                      className="timeline-bar" 
                      onClick={() => onOpen(s)}
                      style={{
                        left, width,
                        background: bg,
                        border: `1px solid ${border}`,
                        color: color
                      }}
                    >
                      {s.name}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
