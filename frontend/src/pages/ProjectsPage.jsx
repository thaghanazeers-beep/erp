import { useState, useEffect, useRef } from 'react';
import { getProjects, createProject, deleteProject, getTasks, createTask, updateTask, deleteTask, getTeam } from '../api';
import { useTeamspace } from '../context/TeamspaceContext';
import TaskDetailPage from './TaskDetailPage';
import ViewTabs from '../components/ViewTabs';
import './ProjectsPage.css';

const PROJECT_ICONS = ['📁', '🚀', '💼', '🎯', '📊', '🛠️', '🎨', '📝', '🔬', '🌐', '📱', '🏗️'];
const PROJECT_COLORS = ['#2383e2', '#0d9488', '#c14c8a', '#d9730d', '#2e9e6b', '#d44c47', '#8a63d2', '#b7791f', '#0e7490', '#64748b'];
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

export default function ProjectsPage() {
  const { activeTeamspaceId } = useTeamspace();
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📁');
  const [color, setColor] = useState('#2383e2');

  // Active project view
  const [activeProject, setActiveProject] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);

  const [views, setViews] = useState(() => {
    const saved = localStorage.getItem('projects_views');
    return saved ? JSON.parse(saved) : [
      { id: 'v1', type: 'cards', name: 'Cards' },
      { id: 'v2', type: 'list', name: 'List' },
      { id: 'v3', type: 'gallery', name: 'Gallery' }
    ];
  });
  const [activeViewId, setActiveViewId] = useState(views[0]?.id || 'v1');
  const viewType = views.find(v => v.id === activeViewId)?.type || 'cards';
  
  // Sub-view for tasks inside a project
  const [projectTaskViews, setProjectTaskViews] = useState(() => {
    const saved = localStorage.getItem('project_task_views');
    return saved ? JSON.parse(saved) : [
      { id: 'pv1', type: 'board', name: 'Board' },
      { id: 'pv2', type: 'table', name: 'Table' },
      { id: 'pv3', type: 'list', name: 'List' }
    ];
  });
  const [activeProjectTaskViewId, setActiveProjectTaskViewId] = useState(projectTaskViews[0]?.id || 'pv1');
  const projectTaskViewType = projectTaskViews.find(v => v.id === activeProjectTaskViewId)?.type || 'board';

  useEffect(() => {
    localStorage.setItem('projects_views', JSON.stringify(views));
  }, [views]);

  useEffect(() => {
    localStorage.setItem('project_task_views', JSON.stringify(projectTaskViews));
  }, [projectTaskViews]);

  const handleAddView = (type, label) => {
    const newId = `v${Date.now()}`;
    setViews(prev => [...prev, { id: newId, type, name: label }]);
    setActiveViewId(newId);
  };

  const handleAddProjectTaskView = (type, label) => {
    const newId = `pv${Date.now()}`;
    setProjectTaskViews(prev => [...prev, { id: newId, type, name: label }]);
    setActiveProjectTaskViewId(newId);
  };

  const dragItem = useRef(null);

  useEffect(() => { fetchAll(); }, [activeTeamspaceId]);

  const fetchAll = async () => {
    try {
      const [pRes, tRes, tmRes] = await Promise.all([getProjects(activeTeamspaceId), getTasks(activeTeamspaceId), getTeam()]);
      setProjects(pRes.data);
      setTasks(tRes.data);
      setTeamMembers(tmRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createProject({ name, description, icon, color });
      setShowCreate(false);
      setName(''); setDescription(''); setIcon('📁'); setColor('#2383e2');
      fetchAll();
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this project and unlink its tasks?')) return;
    try { await deleteProject(id); fetchAll(); } catch (err) { console.error(err); }
  };

  const handleCreateTask = async () => {
    if (!activeProject) return;
    try {
      const newTask = {
        id: `task_${Date.now()}`,
        title: 'Untitled',
        description: '',
        status: 'Not Yet Started',
        assignee: '',
        dueDate: null,
        createdDate: new Date().toISOString(),
        customProperties: [],
        attachments: [],
        parentId: null,
        projectId: activeProject._id,
        estimatedHours: 0,
        actualHours: 0,
      };
      await createTask(newTask);
      fetchAll();
      setSelectedTask(newTask);
    } catch (err) { console.error(err); }
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try { await updateTask(taskId, { status: newStatus }); fetchAll(); }
    catch (err) { console.error(err); }
  };

  const handleDeleteTask = async (id) => {
    try { await deleteTask(id); fetchAll(); } catch (err) { console.error(err); }
  };

  // Drag & Drop
  const handleDragStart = (e, task) => { dragItem.current = task; e.dataTransfer.effectAllowed = 'move'; e.target.classList.add('dragging'); };
  const handleDragEnd = (e) => { e.target.classList.remove('dragging'); dragItem.current = null; document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over')); };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over')); e.currentTarget.closest('.board-column')?.classList.add('drag-over'); };
  const handleDrop = async (e, status) => {
    e.preventDefault();
    document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over'));
    if (dragItem.current && dragItem.current.status !== status) {
      try { await updateTask(dragItem.current.id, { status }); fetchAll(); } catch {}
    }
    dragItem.current = null;
  };

  const projectTasks = activeProject ? tasks.filter(t => t.projectId === activeProject._id && !t.parentId) : [];
  const getTasksByStatus = (status) => projectTasks.filter(t => t.status === status);

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (selectedTask) {
    return (
      <TaskDetailPage
        task={selectedTask}
        onBack={() => { setSelectedTask(null); fetchAll(); }}
        onUpdated={fetchAll}
      />
    );
  }

  if (loading) return <div className="tasks-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;

  // Inside a project — show tasks
  if (activeProject) {
    return (
      <div className="tasks-page">
        <ViewTabs 
          views={projectTaskViews} 
          activeViewId={activeProjectTaskViewId} 
          onChangeView={setActiveProjectTaskViewId} 
          onAddView={handleAddProjectTaskView} 
        />
        <div className="tasks-toolbar" style={{ paddingTop: 0 }}>
          <div className="tasks-toolbar-left">
            <button className="btn btn-ghost btn-sm" onClick={() => setActiveProject(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15,18 9,12 15,6"/></svg>
              Back
            </button>
            <span className="project-active-icon" style={{ background: activeProject.color }}>{activeProject.icon}</span>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{activeProject.name}</h3>
            <span className="tasks-count">{projectTasks.length} tasks</span>
          </div>
          <div className="tasks-toolbar-right">
            <button className="btn btn-primary btn-sm" onClick={handleCreateTask}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Task
            </button>
          </div>
        </div>

        {/* Board View */}
        {projectTaskViewType === 'board' && (
          <div className="board">
            {STATUSES.map((status) => {
              const statusTasks = getTasksByStatus(status);
              return (
                <div className="board-column" key={status} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, status)}>
                  <div className="board-column-header">
                    <div className="board-column-title">
                      <span className={`board-dot ${STATUS_DOT[status]}`} />
                      <h3>{status}</h3>
                      <span className="board-column-count">{statusTasks.length}</span>
                    </div>
                  </div>
                  <div className="board-column-cards">
                    {statusTasks.map((task, i) => (
                      <div className="task-card animate-in" key={task.id} style={{ animationDelay: `${i * 0.05}s` }}
                        draggable onDragStart={(e) => handleDragStart(e, task)} onDragEnd={handleDragEnd}
                        onClick={() => setSelectedTask(task)}
                      >
                        <h4 className="task-card-title">{task.title}</h4>
                        <div className="task-card-footer">
                          <div className="task-card-meta">
                            {task.dueDate && <span className="task-card-date">📅 {formatDate(task.dueDate)}</span>}
                            {(task.estimatedHours > 0 || task.actualHours > 0) && (
                              <span className="task-card-hours">{task.actualHours || 0}/{task.estimatedHours || 0}h</span>
                            )}
                          </div>
                          {task.assignee && (
                            <span className="task-card-assignee">
                              <div className="task-card-avatar">{task.assignee.charAt(0).toUpperCase()}</div>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {statusTasks.length === 0 && <div className="board-empty"><p>Drop tasks here</p></div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* List View */}
        {projectTaskViewType === 'list' && (
          <div className="list-view">
            {projectTasks.length === 0 ? (
              <div className="empty-state"><p>No tasks in this project.</p></div>
            ) : projectTasks.map((task, i) => (
              <div className="list-item animate-in" key={task.id} style={{ animationDelay: `${i * 0.03}s` }} onClick={() => setSelectedTask(task)}>
                <div className="list-item-left">
                  <div className={`list-dot ${STATUS_DOT[task.status] || 'dot-notstarted'}`} />
                  <span className="list-item-title">{task.title}</span>
                </div>
                <div className="list-item-right">
                  {task.assignee && <span className="list-item-assignee">{task.assignee}</span>}
                  {(task.estimatedHours > 0 || task.actualHours > 0) && (
                    <span className="list-item-hours">{task.actualHours || 0}/{task.estimatedHours || 0}h</span>
                  )}
                  {task.dueDate && <span className="list-item-date">{formatDate(task.dueDate)}</span>}
                  <span className={`badge ${STATUS_BADGE[task.status] || 'badge-notstarted'}`}>{task.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Table View */}
        {projectTaskViewType === 'table' && (
          <div className="table-wrapper">
            <table className="task-table">
              <thead>
                <tr><th>Title</th><th>Status</th><th>Assignee</th><th>Est. Hours</th><th>Actual Hours</th><th>Due Date</th><th></th></tr>
              </thead>
              <tbody>
                {projectTasks.map((task, i) => (
                  <tr key={task.id} className="animate-in" style={{ animationDelay: `${i * 0.03}s` }}>
                    <td className="table-title" onClick={() => setSelectedTask(task)}>{task.title}</td>
                    <td>
                      <select className="table-status-select" value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value)}>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="table-assignee">{task.assignee || '—'}</td>
                    <td className="table-hours">{task.estimatedHours || 0}h</td>
                    <td className="table-hours">{task.actualHours || 0}h</td>
                    <td className="table-date">{formatDate(task.dueDate) || '—'}</td>
                    <td>
                      <button className="btn-icon" onClick={() => handleDeleteTask(task.id)} title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {projectTasks.length === 0 && <div className="empty-state" style={{ marginTop: 32 }}><p>No tasks in this project.</p></div>}
          </div>
        )}
      </div>
    );
  }

  // Project grid
  return (
    <div className="projects-page">
      <div className="team-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Projects</h1>
        <ViewTabs 
          views={views} 
          activeViewId={activeViewId} 
          onChangeView={setActiveViewId} 
          onAddView={handleAddView} 
        />
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Project
        </button>
      </div>

      {viewType === 'cards' && (
        <div className="projects-grid animate-in">
          {projects.map((p, i) => (
            <div className="project-card" key={p._id} style={{ animationDelay: `${i * 0.05}s`, borderLeft: `3px solid ${p.color}` }}
              onClick={() => setActiveProject(p)}
            >
              <div className="project-card-top">
                <span className="project-icon">{p.icon}</span>
                <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={(e) => { e.stopPropagation(); handleDelete(p._id); }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
              </div>
              <h3 className="project-name">{p.name}</h3>
              {p.description && <p className="project-desc">{p.description}</p>}
              <div className="project-card-bottom">
                <span className="project-task-count">{p.taskCount || 0} tasks</span>
                <span className="project-date">Created {new Date(p.createdDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewType === 'gallery' && (
        <div className="projects-gallery animate-in">
          {projects.map((p, i) => (
            <div className="project-gallery-card" key={p._id} onClick={() => setActiveProject(p)}>
              <div className="project-gallery-cover" style={{ background: p.color + '22' }}>
                <span style={{ fontSize: '3rem' }}>{p.icon}</span>
              </div>
              <div className="project-gallery-body">
                <h3>{p.name}</h3>
                <p>{p.description || 'No description'}</p>
                <div className="project-gallery-footer">
                  <span>{p.taskCount || 0} tasks</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewType === 'list' && (
        <div className="table-wrapper animate-in">
          <table className="task-table">
            <thead>
              <tr><th>Icon</th><th>Project Name</th><th>Tasks</th><th>Created</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p._id} onClick={() => setActiveProject(p)}>
                  <td style={{ fontSize: '1.2rem' }}>{p.icon}</td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.taskCount || 0}</td>
                  <td>{new Date(p.createdDate).toLocaleDateString()}</td>
                  <td>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleDelete(p._id); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Project</h2>
              <button className="btn-icon" onClick={() => setShowCreate(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="modal-form">
              <div className="form-field">
                <label className="label">Project Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Seyo App, Marketing..." required autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Description</label>
                <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description..." />
              </div>
              <div className="form-field">
                <label className="label">Icon</label>
                <div className="picker-row">
                  {PROJECT_ICONS.map(ic => (
                    <button type="button" key={ic} className={`picker-item ${icon === ic ? 'active' : ''}`} onClick={() => setIcon(ic)}>{ic}</button>
                  ))}
                </div>
              </div>
              <div className="form-field">
                <label className="label">Color</label>
                <div className="picker-row">
                  {PROJECT_COLORS.map(c => (
                    <button type="button" key={c} className={`color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
                  ))}
                </div>
              </div>
              <div className="modal-actions">
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm">Create Project</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
