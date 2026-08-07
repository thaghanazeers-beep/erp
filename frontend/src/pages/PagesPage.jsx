import { useState, useEffect, useRef } from 'react';
import { getPages, createPage, updatePage, deletePage, getTasks, createTask, updateTask, deleteTask } from '../api';
import { useAuth } from '../context/AuthContext';
import './PagesPage.css';

const STATUSES = ['Not Yet Started', 'In Progress', 'In Review', 'Completed', 'Rejected'];
const STATUS_COLOR = {
  'Not Yet Started': 'var(--text-muted)',
  'In Progress':     'var(--accent-blue, #2383e2)',
  'In Review':       '#d9730d',
  'Completed':       'var(--accent-green)',
  'Rejected':        'var(--accent-red, #d44c47)',
};

export default function PagesPage() {
  const { user } = useAuth();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePageId, setActivePageId] = useState(null);

  useEffect(() => {
    fetchPages();
  }, []);

  const fetchPages = async () => {
    try {
      const res = await getPages();
      setPages(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleCreateNewPage = async () => {
    try {
      const res = await createPage({ title: '', icon: '📄', createdBy: user?.name });
      setPages([res.data, ...pages]);
      setActivePageId(res.data._id);
    } catch (e) { console.error(e); }
  };

  const activePage = pages.find(p => p._id === activePageId);

  if (loading) {
    return <div className="pages-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;
  }

  return (
    <div className="pages-container">
      {/* ── Sidebar (List of Pages) ── */}
      <div className="pages-sidebar">
        <div className="pages-sidebar-header">
          <h3>Pages</h3>
          <button className="btn-icon" onClick={handleCreateNewPage} title="New Page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        <div className="pages-list">
          {pages.length === 0 && <p className="pages-empty">No pages yet.</p>}
          {pages.map(p => (
            <button key={p._id} className={`page-list-item ${activePageId === p._id ? 'active' : ''}`} onClick={() => setActivePageId(p._id)}>
              <span className="page-list-icon">{p.icon}</span>
              <span className="page-list-title">{p.title || 'Untitled'}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Editor Area ── */}
      <div className="pages-main">
        {activePage ? (
          <PageEditor 
            page={activePage} 
            onChange={(updatedPage) => {
              setPages(prev => prev.map(p => p._id === updatedPage._id ? updatedPage : p));
            }}
            onDelete={async (id) => {
              try {
                await deletePage(id);
                setPages(prev => prev.filter(p => p._id !== id));
                setActivePageId(null);
              } catch(e) { console.error(e); }
            }}
          />
        ) : (
          <div className="pages-welcome">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)', marginBottom: 16 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <p>Select a page or create a new one.</p>
            <button className="btn btn-primary btn-sm" onClick={handleCreateNewPage}>Create Page</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Notion-style Page Editor ─────────────────────────────
function PageEditor({ page, onChange, onDelete }) {
  const [tasks, setTasks] = useState([]);
  
  // Ref to hold the debounce timer
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    if (page.hasDatabase) fetchPageTasks();
  }, [page._id, page.hasDatabase]);

  const fetchPageTasks = async () => {
    try {
      const res = await getTasks();
      // only keep tasks for this page
      setTasks(res.data.filter(t => t.pageId === page._id));
    } catch (e) { console.error(e); }
  };

  const handleUpdate = (field, value) => {
    const updatedPage = { ...page, [field]: value };
    onChange(updatedPage); // Optimistic UI update

    // Debounce the API call
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try { await updatePage(page._id, { [field]: value }); }
      catch (e) { console.error(e); }
    }, 500);
  };

  const handleAddDatabase = async () => {
    handleUpdate('hasDatabase', true);
  };

  const handleCreateTask = async () => {
    try {
      const newTask = {
        id: `task_${Date.now()}`,
        title: 'New Task',
        status: 'Not Yet Started',
        pageId: page._id,
      };
      await createTask(newTask);
      await fetchPageTasks();
    } catch(e) { console.error(e); }
  };

  const handleTaskStatusChange = async (taskId, status) => {
    try {
      await updateTask(taskId, { status });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    } catch(e) { console.error(e); }
  };

  const handleDeleteTask = async (taskId) => {
    try {
      await deleteTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch(e) { console.error(e); }
  };

  // Group tasks by status for the board
  const boardByStatus = STATUSES.reduce((acc, s) => {
    acc[s] = tasks.filter(t => t.status === s);
    return acc;
  }, {});

  return (
    <div className="page-editor animate-in">
      <div className="page-editor-top">
        <div style={{ flex: 1 }} />
        <button className="btn-icon text-danger" onClick={() => {
          if (confirm('Delete this page? This will also delete any tasks inside its database.')) onDelete(page._id);
        }} title="Delete Page">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="page-hero">
        <input 
          className="page-icon-input" 
          value={page.icon} 
          onChange={(e) => handleUpdate('icon', e.target.value)} 
          maxLength={2}
        />
        <input 
          className="page-title-input" 
          value={page.title} 
          onChange={(e) => handleUpdate('title', e.target.value)} 
          placeholder="Untitled" 
        />
      </div>

      <textarea 
        className="page-content-input" 
        value={page.content} 
        onChange={(e) => handleUpdate('content', e.target.value)} 
        placeholder="Type '/' for commands, or just start typing..."
      />

      {/* Database Block */}
      {!page.hasDatabase ? (
        <div className="page-add-block">
          <button className="btn btn-ghost" onClick={handleAddDatabase}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            Add Task Database
          </button>
        </div>
      ) : (
        <div className="page-database-block">
          <div className="page-database-header">
            <h3>{page.title || 'Untitled'} Tasks</h3>
            <button className="btn btn-primary btn-sm" onClick={handleCreateTask}>New Task</button>
          </div>
          <div className="page-board">
            {STATUSES.map(status => (
              <div className="page-board-col" key={status}>
                <div className="page-board-col-header">
                  <span className="col-dot" style={{ background: STATUS_COLOR[status] }} />
                  <span className="col-title">{status}</span>
                  <span className="col-count">{boardByStatus[status].length}</span>
                </div>
                <div className="page-board-cards">
                  {boardByStatus[status].map(task => (
                    <div className="page-task-card" key={task.id}>
                      <div className="page-task-top">
                        <input 
                          className="page-task-title-input" 
                          defaultValue={task.title} 
                          onBlur={(e) => {
                            if (e.target.value !== task.title) {
                              updateTask(task.id, { title: e.target.value });
                              fetchPageTasks();
                            }
                          }}
                        />
                        <button className="btn-icon text-danger page-task-delete" onClick={() => handleDeleteTask(task.id)}>✕</button>
                      </div>
                      <select
                        className="page-task-status"
                        value={task.status}
                        onChange={e => handleTaskStatusChange(task.id, e.target.value)}
                        style={{ borderColor: STATUS_COLOR[task.status] }}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  ))}
                  {boardByStatus[status].length === 0 && <div className="page-board-empty">No tasks</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
