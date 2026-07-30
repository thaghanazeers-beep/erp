import { useState, useEffect, useRef } from 'react';
import { updateTask, getTeam, createTask, deleteTask, getTasks, getProjects, getSprints, uploadTaskAttachments } from '../api';
import { useAuth } from '../context/AuthContext';
import './TaskDetailPage.css';

const STATUSES = ['Not Yet Started', 'In Progress', 'In Review', 'Completed', 'Rejected'];

export default function TaskDetailPage({ task, onBack, onUpdated }) {
  const auth = useAuth();
  const currentUser = auth?.user;
  const [title, setTitle] = useState(task?.title || '');
  const [blocks, setBlocks] = useState(() => {
    if (task?.description) {
      try { const p = JSON.parse(task.description); if (Array.isArray(p)) return p; } catch {}
      return [{ id: Date.now().toString(), type: 'text', content: task.description }];
    }
    return [{ id: Date.now().toString(), type: 'text', content: '' }];
  });
  const [status, setStatus] = useState(task?.status || 'Not Yet Started');
  const [assignee, setAssignee] = useState(task?.assignee || '');
  const [dueDate, setDueDate] = useState(task?.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '');
  const [attachments, setAttachments] = useState(task?.attachments || []);
  const [projectId, setProjectId] = useState(task?.projectId || '');
  const [estimatedHours, setEstimatedHours] = useState(task?.estimatedHours || 0);
  const [actualHours, setActualHours] = useState(task?.actualHours || 0);
  const [sprintId, setSprintId] = useState(task?.sprintId || '');
  const [childTasks, setChildTasks] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [showBlockMenu, setShowBlockMenu] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const titleRef = useRef(null);
  const saveTimer = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadTeam(); loadProjects(); loadSprints(); loadChildTasks(); }, []);
  useEffect(() => { if (titleRef.current && !task) titleRef.current.focus(); }, []);

  const loadTeam = async () => { try { const r = await getTeam(); setTeamMembers(r.data); } catch {} };
  const loadProjects = async () => { try { const r = await getProjects(); setProjects(r.data); } catch {} };
  const loadSprints = async () => { try { const r = await getSprints(); setSprints(r.data); } catch {} };
  const loadChildTasks = async () => {
    if (!task?.id) return;
    try { const r = await getTasks(); setChildTasks(r.data.filter(t => t.parentId === task.id)); } catch {}
  };

  const autoSave = (updates = {}) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!task?.id) return;
      setSaving(true);
      try {
        await updateTask(task.id, {
          title: updates.title ?? title,
          description: JSON.stringify(updates.blocks ?? blocks),
          status: updates.status ?? status,
          assignee: updates.assignee ?? assignee,
          dueDate: (updates.dueDate ?? dueDate) || null,
          attachments: updates.attachments ?? attachments,
          projectId: (updates.projectId ?? projectId) || null,
          sprintId: (updates.sprintId ?? sprintId) || null,
          estimatedHours: updates.estimatedHours ?? estimatedHours,
          actualHours: updates.actualHours ?? actualHours,
          updatedBy: currentUser?.name || 'Someone',
        });
        setLastSaved(new Date());
        onUpdated?.();
      } catch (err) { console.error(err); }
      finally { setSaving(false); }
    }, 800);
  };

  const isAdminOrOwner = currentUser?.role === 'Admin' || currentUser?.role === 'Team Owner';
  const isAssignee = currentUser?.name === assignee || !assignee;
  const canEdit = isAdminOrOwner || isAssignee;

  const canChangeStatusTo = (newStatus) => {
    if (!canEdit) return false;
    if (isAdminOrOwner) return true;
    if (newStatus === 'Completed' || newStatus === 'Rejected') return false;
    return true;
  };

  const handleTitleChange = (v) => { if (!canEdit) return; setTitle(v); autoSave({ title: v }); };
  const handleStatusChange = (v) => { if (!canChangeStatusTo(v)) return; setStatus(v); autoSave({ status: v }); };
  const handleAssigneeChange = (m) => { if (!canEdit) return; setAssignee(m.name); setShowAssigneeDropdown(false); autoSave({ assignee: m.name }); };
  const handleDueDateChange = (v) => { if (!canEdit) return; setDueDate(v); autoSave({ dueDate: v }); };
  const handleEstHoursChange = (v) => { if (!canEdit) return; const n = parseFloat(v) || 0; setEstimatedHours(n); autoSave({ estimatedHours: n }); };
  const handleActHoursChange = (v) => { if (!canEdit) return; const n = parseFloat(v) || 0; setActualHours(n); autoSave({ actualHours: n }); };

  // Review/Approval actions
  const handleSubmitForReview = () => { setStatus('In Review'); autoSave({ status: 'In Review' }); };
  const handleApprove = () => { setStatus('Completed'); autoSave({ status: 'Completed' }); };
  const handleReject = () => { setStatus('Rejected'); autoSave({ status: 'Rejected' }); };
  const handleRework = () => { setStatus('In Progress'); autoSave({ status: 'In Progress' }); };

  const updateBlock = (id, content) => { if (!canEdit) return; const u = blocks.map(b => b.id === id ? { ...b, content } : b); setBlocks(u); autoSave({ blocks: u }); };
  const addBlock = (afterId, type = 'text') => {
    if (!canEdit) return;
    const nb = { id: Date.now().toString(), type, content: '' };
    const idx = blocks.findIndex(b => b.id === afterId);
    const u = [...blocks]; u.splice(idx + 1, 0, nb); setBlocks(u); setShowBlockMenu(null);
    setTimeout(() => { document.querySelector(`[data-block-id="${nb.id}"]`)?.focus(); }, 50);
  };
  const removeBlock = (id) => {
    if (!canEdit || blocks.length <= 1) return;
    const u = blocks.filter(b => b.id !== id); setBlocks(u); autoSave({ blocks: u });
    const idx = blocks.findIndex(b => b.id === id);
    if (idx > 0) setTimeout(() => { document.querySelector(`[data-block-id="${blocks[idx-1].id}"]`)?.focus(); }, 50);
  };
  const handleBlockKeyDown = (e, block) => {
    if (!canEdit) return;
    if (e.key === 'Enter' && !e.shiftKey && block.type === 'text') { e.preventDefault(); addBlock(block.id, 'text'); }
    if (e.key === 'Backspace' && block.content === '' && blocks.length > 1) { e.preventDefault(); removeBlock(block.id); }
    if (e.key === '/' && block.content === '') { e.preventDefault(); setShowBlockMenu(block.id); }
  };

  const handleFileAdd = async (e) => {
    if (!canEdit) return;
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file later
    if (!files.length || !task?.id) return;
    setUploadError('');
    setUploading(true);
    try {
      // Real upload — files are stored on the server; the returned list is
      // the task's full attachment array with permanent URLs.
      const res = await uploadTaskAttachments(task.id, files);
      setAttachments(res.data.attachments);
      setLastSaved(new Date());
      onUpdated?.();
    } catch (err) {
      setUploadError(err.response?.data?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };
  const removeAttachment = (id) => { if (!canEdit) return; const u = attachments.filter(a => a.id !== id); setAttachments(u); autoSave({ attachments: u }); };

  const addChildTask = async () => {
    if (!canEdit) return;
    try {
      const child = { id: `task_${Date.now()}`, title: 'Untitled subtask', description: '', status: 'Not Yet Started', assignee: '', dueDate: null, createdDate: new Date().toISOString(), customProperties: [], attachments: [], parentId: task.id, estimatedHours: 0, actualHours: 0 };
      await createTask(child); loadChildTasks(); onUpdated?.();
    } catch {}
  };

  const formatSize = (b) => { if (!b) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; };

  const blockTypes = [
    { type: 'text', label: 'Text', icon: 'T', desc: 'Plain text block' },
    { type: 'heading', label: 'Heading', icon: 'H', desc: 'Large heading' },
    { type: 'bullet', label: 'Bullet List', icon: '•', desc: 'Bulleted list item' },
    { type: 'checkbox', label: 'To-do', icon: '☐', desc: 'Checkbox item' },
    { type: 'quote', label: 'Quote', icon: '"', desc: 'Quote block' },
    { type: 'divider', label: 'Divider', icon: '—', desc: 'Horizontal line' },
    { type: 'code', label: 'Code', icon: '</>', desc: 'Code snippet' },
    { type: 'callout', label: 'Callout', icon: '💡', desc: 'Highlighted callout' },
  ];

  const isAdmin = currentUser?.role === 'Admin' || currentUser?.role === 'Team Owner';

  return (
    <div className="task-detail-page">
      <div className="td-topbar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15,18 9,12 15,6"/></svg>
          Back
        </button>
        <div className="td-topbar-right">
          {saving && <span className="td-saving">Saving...</span>}
          {!saving && lastSaved && <span className="td-saved">✓ Saved</span>}
        </div>
      </div>

      {/* Review/Approval Banner */}
      {status === 'In Review' && isAdmin && (
        <div className="td-review-banner">
          <span>📝 This task is awaiting your review</span>
          <div className="td-review-actions">
            <button className="btn btn-sm btn-approve" onClick={handleApprove}>✅ Approve</button>
            <button className="btn btn-sm btn-reject" onClick={handleReject}>❌ Reject</button>
          </div>
        </div>
      )}
      {status === 'Rejected' && isAssignee && (
        <div className="td-review-banner td-rejected-banner">
          <span>❌ This task was rejected. Please rework and resubmit.</span>
          <button className="btn btn-sm btn-primary" onClick={handleRework}>🔄 Start Rework</button>
        </div>
      )}

      <div className="td-layout">
        <div className="td-main" style={{ opacity: canEdit ? 1 : 0.8, pointerEvents: canEdit ? 'auto' : 'none' }}>
          <input ref={titleRef} className="td-title" value={title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="Untitled" readOnly={!canEdit} />

          <div className="td-blocks">
            {blocks.map((block) => (
              <div className="td-block-wrapper" key={block.id}>
                <div className="td-block-handle" onClick={() => setShowBlockMenu(showBlockMenu === block.id ? null : block.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </div>
                <div className="td-block-drag">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/><circle cx="15" cy="18" r="2"/></svg>
                </div>
                {block.type === 'divider' ? <hr className="td-divider" />
                : block.type === 'heading' ? <input data-block-id={block.id} className="td-block-input td-block-heading" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="Heading..." />
                : block.type === 'bullet' ? (
                  <div className="td-block-bullet-row"><span className="td-bullet-dot">•</span><input data-block-id={block.id} className="td-block-input" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="List item..." /></div>
                ) : block.type === 'checkbox' ? (
                  <div className="td-block-checkbox-row">
                    <input type="checkbox" className="td-checkbox" checked={block.content.startsWith('[x]')} onChange={(e) => { const t = block.content.replace(/^\[[ x]\]\s*/, ''); updateBlock(block.id, e.target.checked ? `[x] ${t}` : t); }} />
                    <input data-block-id={block.id} className={`td-block-input ${block.content.startsWith('[x]') ? 'td-checked' : ''}`} value={block.content.replace(/^\[[ x]\]\s*/, '')} onChange={(e) => { const p = block.content.startsWith('[x]') ? '[x] ' : ''; updateBlock(block.id, p + e.target.value); }} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="To-do..." />
                  </div>
                ) : block.type === 'quote' ? (
                  <div className="td-block-quote"><textarea data-block-id={block.id} className="td-block-textarea" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addBlock(block.id); }}} placeholder="Quote..." rows={2} /></div>
                ) : block.type === 'code' ? (
                  <textarea data-block-id={block.id} className="td-block-textarea td-block-code" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} placeholder="// Code..." rows={3} />
                ) : block.type === 'callout' ? (
                  <div className="td-block-callout"><span className="td-callout-icon">💡</span><input data-block-id={block.id} className="td-block-input" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="Callout text..." /></div>
                ) : (
                  <textarea data-block-id={block.id} className="td-block-textarea td-block-text" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="Type '/' for commands, or start writing..." rows={1} onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} />
                )}
                {showBlockMenu === block.id && (
                  <div className="td-block-menu animate-in">
                    <div className="td-block-menu-title">Block Type</div>
                    {blockTypes.map(bt => (
                      <button key={bt.type} className="td-block-menu-item" onClick={() => {
                        if (bt.type === 'divider') { addBlock(block.id, 'divider'); } else { const u = blocks.map(b => b.id === block.id ? { ...b, type: bt.type } : b); setBlocks(u); setShowBlockMenu(null); autoSave({ blocks: u }); }
                      }}><span className="td-block-menu-icon">{bt.icon}</span><div><div className="td-block-menu-label">{bt.label}</div><div className="td-block-menu-desc">{bt.desc}</div></div></button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Attachments */}
          <div className="td-section">
            <div className="td-section-header"><h3>Attachments</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading
                  ? <span className="spinner" style={{ width: 14, height: 14 }} />
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>}
                {uploading ? ' Uploading…' : ' Add'}
              </button>
              <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileAdd} />
            </div>
            {uploadError && <p className="td-empty-hint" style={{ color: 'var(--danger, #e74c3c)' }}>{uploadError}</p>}
            {attachments.length > 0 ? (
              <div className="td-attachments">{attachments.map(att => (
                <div className="td-attachment" key={att.id}>
                  <div className="td-attachment-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg></div>
                  <div className="td-attachment-info">
                    {att.path && !att.path.startsWith('blob:') ? (
                      <a className="td-attachment-name" href={att.path} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{att.name}</a>
                    ) : (
                      <span className="td-attachment-name" title="File was added before uploads were supported — re-attach it">{att.name} (unavailable)</span>
                    )}
                    <span className="td-attachment-size">{formatSize(att.sizeBytes)}</span>
                  </div>
                  <button className="btn-icon" onClick={() => removeAttachment(att.id)} style={{ width: 28, height: 28 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
              ))}</div>
            ) : <p className="td-empty-hint">No attachments.</p>}
          </div>

          {/* Subtasks */}
          {task?.id && (
            <div className="td-section">
              <div className="td-section-header"><h3>Subtasks</h3>
                <button className="btn btn-ghost btn-sm" onClick={addChildTask}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add</button>
              </div>
              {childTasks.length > 0 ? (
                <div className="td-subtasks">{childTasks.map(c => (
                  <div className="td-subtask" key={c.id}>
                    <div className={`list-dot ${c.status === 'Completed' ? 'dot-done' : c.status === 'In Progress' ? 'dot-progress' : c.status === 'In Review' ? 'dot-review' : c.status === 'Rejected' ? 'dot-rejected' : 'dot-notstarted'}`} />
                    <span className="td-subtask-title">{c.title}</span>
                    <span className={`badge badge-sm ${c.status === 'Completed' ? 'badge-done' : c.status === 'In Progress' ? 'badge-progress' : c.status === 'In Review' ? 'badge-review' : c.status === 'Rejected' ? 'badge-rejected' : 'badge-notstarted'}`}>{c.status}</span>
                  </div>
                ))}</div>
              ) : <p className="td-empty-hint">No subtasks yet.</p>}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="td-sidebar">
          <h3 className="td-sidebar-title">Properties</h3>

          <div className="td-prop"><label className="td-prop-label">Project</label>
            <select className="td-prop-select" value={projectId} onChange={(e) => { setProjectId(e.target.value); autoSave({ projectId: e.target.value }); }} disabled={!canEdit}>
              <option value="">No project</option>{projects.map(p => <option key={p._id} value={p._id}>{p.icon} {p.name}</option>)}
            </select>
          </div>

          <div className="td-prop"><label className="td-prop-label">Sprint</label>
            <select className="td-prop-select" value={sprintId} onChange={(e) => { setSprintId(e.target.value); autoSave({ sprintId: e.target.value }); }} disabled={!canEdit}>
              <option value="">No sprint</option>{sprints.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </div>

          <div className="td-prop"><label className="td-prop-label">Status</label>
            <select className="td-prop-select" value={status} onChange={(e) => handleStatusChange(e.target.value)} disabled={!canEdit}>
              {STATUSES.map(s => <option key={s} value={s} disabled={!canChangeStatusTo(s)}>{s}</option>)}
            </select>
          </div>

          {/* Quick Review Actions */}
          {status === 'In Progress' && isAssignee && (
            <div className="td-prop"><button className="btn btn-sm btn-review-submit" onClick={handleSubmitForReview} style={{ width: '100%' }}>📝 Submit for Review</button></div>
          )}

          <div className="td-prop"><label className="td-prop-label">Assignee</label>
            <div className="td-assignee-wrapper">
              <button className="td-assignee-btn" onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}>
                {assignee ? (<div className="td-assignee-selected"><div className="td-assignee-avatar-sm">{assignee.charAt(0).toUpperCase()}</div><span>{assignee}</span></div>) : (<span className="td-assignee-placeholder">Select assignee...</span>)}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6,9 12,15 18,9"/></svg>
              </button>
              {showAssigneeDropdown && (
                <div className="td-assignee-dropdown animate-in">
                  {assignee && <button className="td-assignee-option" onClick={() => { setAssignee(''); setShowAssigneeDropdown(false); autoSave({ assignee: '' }); }}><span className="td-assignee-none">✕</span><span>Unassigned</span></button>}
                  {teamMembers.map(m => (
                    <button className="td-assignee-option" key={m._id} onClick={() => handleAssigneeChange(m)}>
                      <div className="td-assignee-avatar-sm">{m.profilePictureUrl ? <img src={m.profilePictureUrl} alt="" /> : m.name?.charAt(0)?.toUpperCase()}</div>
                      <div className="td-assignee-option-info"><span className="td-assignee-option-name">{m.name}</span><span className="td-assignee-option-email">{m.email}</span></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="td-prop"><label className="td-prop-label">Due Date</label>
            <input className="td-prop-input" type="date" value={dueDate} onChange={(e) => handleDueDateChange(e.target.value)} />
          </div>

          <div className="td-prop"><label className="td-prop-label">Estimated Hours</label>
            <input className="td-prop-input" type="number" min="0" step="0.5" value={estimatedHours} onChange={(e) => handleEstHoursChange(e.target.value)} />
          </div>

          <div className="td-prop"><label className="td-prop-label">Actual Hours</label>
            <input className="td-prop-input" type="number" min="0" step="0.5" value={actualHours} onChange={(e) => handleActHoursChange(e.target.value)} />
          </div>

          {estimatedHours > 0 && (
            <div className="td-hours-bar">
              <div className="td-hours-progress" style={{ width: `${Math.min(100, (actualHours / estimatedHours) * 100)}%`, background: actualHours > estimatedHours ? 'var(--accent-red)' : 'var(--primary)' }} />
              <span className="td-hours-label">{actualHours}/{estimatedHours}h ({Math.round((actualHours / estimatedHours) * 100)}%)</span>
            </div>
          )}

          <div className="td-prop"><label className="td-prop-label">Created</label>
            <span className="td-prop-value">{task?.createdDate ? new Date(task.createdDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Now'}</span>
          </div>

          {task?.id && (
            <div className="td-prop" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-danger btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={async () => { if (!confirm('Delete this task?')) return; await deleteTask(task.id); onUpdated?.(); onBack(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                Delete Task
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
