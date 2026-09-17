import { useState, useRef } from 'react';
import {
  updateTask, deleteTask, createTask, uploadTaskAttachments, downloadAttachmentBlob,
  addTaskComment, reactTaskComment, deleteTaskComment,
} from '../api';
import FileTypeIcon from './FileTypeIcon';
import FilePreviewModal from './FilePreviewModal';
import Avatar from './Avatar';
import { tagColor, relTime, renderRich } from './taskUtils';
import './TaskPanel.css';

const QUICK_EMOJI = ['👍', '🔥', '❤️', '✅', '👀', '🎉', '👌', '😄'];
const SUGGESTIONS = ["I'll do it 🔥", 'Okay 👌', "Well, I'll get it done right away 👀"];
const STATUS_BADGE = {
  'Not Yet Started': 'badge-notstarted', 'In Progress': 'badge-progress',
  'In Review': 'badge-review', 'Completed': 'badge-done', 'Rejected': 'badge-rejected',
};
const BLOCK_TYPES = [
  { type: 'text', label: 'Text', icon: 'T' }, { type: 'heading', label: 'Heading', icon: 'H' },
  { type: 'bullet', label: 'Bullet', icon: '•' }, { type: 'checkbox', label: 'To-do', icon: '☐' },
  { type: 'quote', label: 'Quote', icon: '"' }, { type: 'code', label: 'Code', icon: '</>' },
  { type: 'callout', label: 'Callout', icon: '💡' }, { type: 'divider', label: 'Divider', icon: '—' },
];
const TYPE_ICON = Object.fromEntries(BLOCK_TYPES.map(b => [b.type, b.icon]));

// tagColor / relTime / renderRich live in ./taskUtils.jsx (shared with the board)

const parseBlocks = (description) => {
  if (description) {
    try { const p = JSON.parse(description); if (Array.isArray(p)) return p; } catch { /* plain text */ }
    return [{ id: String(Date.now()), type: 'text', content: description }];
  }
  return [{ id: String(Date.now()), type: 'text', content: '' }];
};
const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const formatSize = (b) => { if (!b) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; };
const autoGrow = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };

export default function TaskPanel({
  task, allTasks = [], teamMembers = [], projects = [], sprints = [],
  statuses = [], priorities = [], priorityColor = {}, currentUser,
  canEdit, canChangeStatusTo, onClose, onOpenFull, onUpdated, onDeleted,
}) {
  const [tab, setTab] = useState('description');
  const [title, setTitle] = useState(task.title || '');
  const [status, setStatus] = useState(task.status || 'Not Yet Started');
  const [assignee, setAssignee] = useState(task.assignee || '');
  const [dueDate, setDueDate] = useState(toDateInput(task.dueDate));
  const [priority, setPriority] = useState(task.priority || '');
  const [tags, setTags] = useState(task.taskType || []);
  const [blocks, setBlocks] = useState(() => parseBlocks(task.description));
  // Comments and attachments are read straight from the task: every mutation
  // awaits the parent's refetch, so the prop is the single source of truth.
  const attachments = task.attachments || [];
  const comments = task.comments || [];
  const [tagInput, setTagInput] = useState('');
  const [subInput, setSubInput] = useState('');
  const [showPeople, setShowPeople] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [blockMenu, setBlockMenu] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [previewAtt, setPreviewAtt] = useState(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [reactFor, setReactFor] = useState(null);
  const saveTimer = useRef(null);
  const fileRef = useRef(null);
  const draftRef = useRef(null);

  // The parent renders this panel with key={task.id}: opening a different task
  // remounts it, so the useState initializers above re-seed every field.

  const autoSave = (patch) => {
    if (!canEdit) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await updateTask(task.id, { ...patch, updatedBy: currentUser?.name });
        setSaved(true);
        onUpdated?.();
      } catch (err) { console.error(err); }
      finally { setSaving(false); }
    }, 600);
  };

  // ── Fields ────────────────────────────────────────────────────────────
  const changeTitle = (v) => { setTitle(v); autoSave({ title: v }); };
  const changeStatus = (v) => { if (!canChangeStatusTo(v)) return; setStatus(v); autoSave({ status: v }); };
  const changeAssignee = (name) => { setAssignee(name); setShowPeople(false); autoSave({ assignee: name }); };
  const changeDue = (v) => { setDueDate(v); autoSave({ dueDate: v || null }); };
  const changePriority = (v) => { setPriority(v); autoSave({ priority: v }); };
  const addTag = () => {
    const t = tagInput.trim(); setTagInput('');
    if (!t || tags.includes(t)) return;
    const next = [...tags, t]; setTags(next); autoSave({ taskType: next });
  };
  const removeTag = (t) => { const next = tags.filter(x => x !== t); setTags(next); autoSave({ taskType: next }); };

  // ── Description blocks (same JSON format as the full-page editor) ─────
  const saveBlocks = (u) => { setBlocks(u); autoSave({ description: JSON.stringify(u) }); };
  const updateBlock = (id, content) => saveBlocks(blocks.map(b => (b.id === id ? { ...b, content } : b)));
  const setBlockType = (id, type) => { setBlockMenu(null); saveBlocks(blocks.map(b => (b.id === id ? { ...b, type } : b))); };
  const focusBlock = (id) => setTimeout(() => document.querySelector(`[data-pb="${id}"]`)?.focus(), 30);
  const addBlockAfter = (id, type = 'text') => {
    const nb = { id: String(Date.now()), type, content: '' };
    const i = blocks.findIndex(b => b.id === id);
    const u = [...blocks]; u.splice(i + 1, 0, nb); saveBlocks(u); setBlockMenu(null);
    if (type !== 'divider') focusBlock(nb.id);
  };
  const removeBlock = (id) => {
    if (blocks.length <= 1) return;
    const i = blocks.findIndex(b => b.id === id);
    saveBlocks(blocks.filter(b => b.id !== id));
    if (i > 0) focusBlock(blocks[i - 1].id);
  };
  const onBlockKey = (e, b) => {
    if (!canEdit) return;
    if (e.key === 'Enter' && !e.shiftKey && b.type !== 'code' && b.type !== 'quote') { e.preventDefault(); addBlockAfter(b.id); }
    if (e.key === 'Backspace' && !b.content && blocks.length > 1) { e.preventDefault(); removeBlock(b.id); }
  };

  // ── Subtasks & progress ───────────────────────────────────────────────
  const subtasks = allTasks.filter(t => t.parentId === task.id);
  const doneSubs = subtasks.filter(s => s.status === 'Completed').length;
  const progress = subtasks.length
    ? Math.round((100 * doneSubs) / subtasks.length)
    : task.estimatedHours > 0
      ? Math.min(100, Math.round((100 * (task.actualHours || 0)) / task.estimatedHours))
      : ({ 'Not Yet Started': 0, 'In Progress': 35, 'In Review': 80, 'Completed': 100, 'Rejected': 0 }[status] ?? 0);
  const toggleSub = async (s) => {
    if (!canEdit) return;
    try { await updateTask(s.id, { status: s.status === 'Completed' ? 'Not Yet Started' : 'Completed', updatedBy: currentUser?.name }); onUpdated?.(); } catch (err) { console.error(err); }
  };
  const addSub = async () => {
    const t = subInput.trim(); if (!t || !canEdit) return;
    setSubInput('');
    try {
      await createTask({
        id: `task_${Date.now()}`, title: t, description: '', status: 'Not Yet Started', assignee: '', dueDate: null,
        createdDate: new Date().toISOString(), customProperties: [], attachments: [], parentId: task.id,
        projectId: task.projectId || null, sprintId: task.sprintId || null, estimatedHours: 0, actualHours: 0,
      });
      onUpdated?.();
    } catch (err) { console.error(err); }
  };

  // ── Attachments ───────────────────────────────────────────────────────
  const onFiles = async (e) => {
    if (!canEdit) return;
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    setUploadError(''); setUploading(true);
    try { await uploadTaskAttachments(task.id, files); await onUpdated?.(); }
    catch (err) { setUploadError(err.response?.data?.message || 'Upload failed. Please try again.'); }
    finally { setUploading(false); }
  };
  const removeAtt = async (id) => {
    if (!canEdit) return;
    try {
      await updateTask(task.id, { attachments: attachments.filter(a => a.id !== id), updatedBy: currentUser?.name });
      await onUpdated?.();
    } catch (err) { console.error(err); }
  };
  const downloadAtt = async (att) => {
    if (!att.path || att.path.startsWith('blob:')) return;
    if (att.path.startsWith('/api/files/attachments/')) {
      try {
        const res = await downloadAttachmentBlob(att.path.split('/').pop());
        const url = URL.createObjectURL(res.data);
        const a = document.createElement('a'); a.href = url; a.download = att.name || 'file';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch { setUploadError('Download failed — the file may have been removed.'); }
    } else {
      window.open(att.path, '_blank');
    }
  };

  // ── Discussion ────────────────────────────────────────────────────────
  const wrapSel = (before, after = before) => {
    const el = draftRef.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = draft.slice(s, e) || 'text';
    setDraft(draft.slice(0, s) + before + sel + after + draft.slice(e));
    setTimeout(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + sel.length); }, 0);
  };
  const insertAtCursor = (str) => {
    const el = draftRef.current; const s = el?.selectionStart ?? draft.length;
    setDraft(draft.slice(0, s) + str + draft.slice(s));
    setTimeout(() => { el?.focus(); el?.setSelectionRange(s + str.length, s + str.length); }, 0);
  };
  const addLink = () => {
    const url = prompt('Link URL'); if (!url) return;
    const el = draftRef.current; const s = el?.selectionStart ?? draft.length, e = el?.selectionEnd ?? draft.length;
    const label = draft.slice(s, e) || url;
    setDraft(draft.slice(0, s) + `[${label}](${url})` + draft.slice(e));
  };
  const publish = async () => {
    const text = draft.trim(); if (!text || posting) return;
    setPosting(true);
    try { await addTaskComment(task.id, text); setDraft(''); await onUpdated?.(); }
    catch (err) { console.error(err); }
    finally { setPosting(false); }
  };
  const react = async (cid, emoji) => {
    setReactFor(null);
    try { await reactTaskComment(task.id, cid, emoji); await onUpdated?.(); } catch (err) { console.error(err); }
  };
  const removeComment = async (cid) => {
    if (!confirm('Delete this comment?')) return;
    try { await deleteTaskComment(task.id, cid); await onUpdated?.(); } catch (err) { console.error(err); }
  };
  const reply = (c) => { setDraft(`@${c.author} `); setTimeout(() => draftRef.current?.focus(), 0); };

  const isAdmin = currentUser?.role === 'Admin' || currentUser?.role === 'Team Owner';
  const project = projects.find(p => p._id === task.projectId);
  const sprint = sprints.find(s => s._id === task.sprintId);

  return (
    <>
      <div className="tp-backdrop" onClick={onClose} />
      <aside className="tp-panel animate-panel" role="dialog" aria-label="Task details">
        {/* ── Header ── */}
        <header className="tp-head">
          <div className="tp-head-row">
            <div className="tp-proj-icon">{project?.icon || (project?.name || title || 'T').charAt(0).toUpperCase()}</div>
            <div className="tp-head-text">
              <input className="tp-head-title" value={title} onChange={e => changeTitle(e.target.value)} readOnly={!canEdit} placeholder="Untitled task" />
              <div className="tp-head-sub">
                {project ? <><span className="tp-head-k">Project:</span> {project.name}</> : <span className="tp-head-k">No project</span>}
                {sprint && <> · <span className="tp-head-k">Sprint:</span> {sprint.name}</>}
              </div>
            </div>
            <div className="tp-head-actions">
              <span className="tp-save">{saving ? 'Saving…' : saved ? '✓ Saved' : ''}</span>
              <div className="tp-menu-wrap">
                <button className="btn-icon" title="More" onClick={() => setShowMenu(!showMenu)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
                </button>
                {showMenu && (
                  <div className="tp-menu animate-in">
                    <button onClick={() => { setShowMenu(false); onOpenFull?.(); }}>Open full page</button>
                    {canEdit && (
                      <button className="danger" onClick={async () => {
                        if (!confirm('Delete this task?')) return;
                        try { await deleteTask(task.id); onDeleted?.(); } catch (err) { console.error(err); }
                      }}>Delete task</button>
                    )}
                  </div>
                )}
              </div>
              <button className="btn-icon" title="Open full page" onClick={onOpenFull}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              </button>
              <button className="btn-icon" title="Close" onClick={onClose}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </header>

        <div className="tp-body">
          {/* ── Properties ── */}
          <div className="tp-fields">
            <div className="tp-field">
              <span className="tp-label">Task name</span>
              <input className="tp-input" value={title} onChange={e => changeTitle(e.target.value)} readOnly={!canEdit} />
            </div>
            <div className="tp-field">
              <span className="tp-label">People</span>
              <div className="tp-people">
                {assignee
                  ? <span className="tp-person"><Avatar name={assignee} members={teamMembers} size={22} /> {assignee}</span>
                  : <span className="tp-muted">Unassigned</span>}
                {canEdit && (
                  <div className="tp-people-wrap">
                    <button className="tp-add-circle" title="Assign" onClick={() => setShowPeople(!showPeople)}>+</button>
                    {showPeople && (
                      <div className="tp-dropdown animate-in">
                        {assignee && <button onClick={() => changeAssignee('')}><span className="tp-muted">✕</span> Unassign</button>}
                        {teamMembers.map(m => (
                          <button key={m._id || m.name} onClick={() => changeAssignee(m.name)}>
                            <Avatar name={m.name} members={teamMembers} size={20} /> <span>{m.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="tp-field">
              <span className="tp-label">Due date</span>
              <input type="date" className="tp-input tp-date" value={dueDate} onChange={e => changeDue(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="tp-field">
              <span className="tp-label">Status</span>
              <select className={`tp-select badge ${STATUS_BADGE[status] || 'badge-notstarted'}`} value={status} onChange={e => changeStatus(e.target.value)} disabled={!canEdit}>
                {statuses.map(s => <option key={s} value={s} disabled={!canChangeStatusTo(s)}>{s}</option>)}
              </select>
            </div>
            <div className="tp-field">
              <span className="tp-label">Tags</span>
              <div className="tp-tags">
                {tags.map(t => {
                  const [bg, fg] = tagColor(t);
                  return (
                    <span key={t} className="tp-tag" style={{ background: bg, color: fg }}>
                      {t}{canEdit && <button onClick={() => removeTag(t)} title="Remove tag">×</button>}
                    </span>
                  );
                })}
                {canEdit && (
                  <input className="tp-tag-input" placeholder="+ Add more" value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    onBlur={addTag} />
                )}
              </div>
            </div>
            <div className="tp-field">
              <span className="tp-label">Priority</span>
              <select className="tp-select" value={priority} onChange={e => changePriority(e.target.value)} disabled={!canEdit}
                style={{ color: priorityColor[priority] || 'var(--text-secondary)', background: (priorityColor[priority] || '#888888') + '18' }}>
                <option value="">None</option>
                {priorities.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="tp-field">
              <span className="tp-label">Created</span>
              <span className="tp-value">
                {task.createdDate ? new Date(task.createdDate).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                {task.updatedBy && <span className="tp-muted"> · last edited by {task.updatedBy}</span>}
              </span>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="tp-tabs">
            <button className={tab === 'description' ? 'active' : ''} onClick={() => setTab('description')}>Description</button>
            <button className={tab === 'discussion' ? 'active' : ''} onClick={() => setTab('discussion')}>
              Discussion {comments.length > 0 && <span className="tp-tab-count">{comments.length}</span>}
            </button>
            <button className={tab === 'attachments' ? 'active' : ''} onClick={() => setTab('attachments')}>
              Attachments {attachments.length > 0 && <span className="tp-tab-count">{attachments.length}</span>}
            </button>
          </div>

          {/* ── Description ── */}
          {tab === 'description' && (
            <div className="tp-tabpanel">
              <div className="tp-progress">
                <span>Progress</span>
                <div className="tp-bar"><i style={{ width: `${progress}%`, background: progress >= 100 ? 'var(--accent-green)' : 'var(--primary)' }} /></div>
                <b>{progress}%</b>
              </div>

              <div className="tp-blocks" style={{ opacity: canEdit ? 1 : 0.85 }}>
                {blocks.map(b => {
                  const common = { 'data-pb': b.id, readOnly: !canEdit, onKeyDown: (e) => onBlockKey(e, b) };
                  return (
                    <div className="pb" key={b.id}>
                      <div className="pb-gutter">
                        {canEdit && <button className="pb-type" title="Block type" onClick={() => setBlockMenu(blockMenu === b.id ? null : b.id)}>{TYPE_ICON[b.type] || 'T'}</button>}
                        {blockMenu === b.id && (
                          <div className="tp-dropdown pb-menu animate-in">
                            {BLOCK_TYPES.map(bt => (
                              <button key={bt.type} onClick={() => (bt.type === 'divider' ? addBlockAfter(b.id, 'divider') : setBlockType(b.id, bt.type))}>
                                <span className="pb-menu-icon">{bt.icon}</span> {bt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {b.type === 'divider' ? <hr className="pb-divider" />
                        : b.type === 'heading' ? <input className="pb-input pb-heading" value={b.content} placeholder="Heading" onChange={e => updateBlock(b.id, e.target.value)} {...common} />
                        : b.type === 'bullet' ? (
                          <div className="pb-row"><span className="pb-dot">•</span><input className="pb-input" value={b.content} placeholder="List item" onChange={e => updateBlock(b.id, e.target.value)} {...common} /></div>
                        ) : b.type === 'checkbox' ? (
                          <div className="pb-row">
                            <input type="checkbox" className="pb-check" checked={b.content.startsWith('[x]')} disabled={!canEdit}
                              onChange={e => { const t = b.content.replace(/^\[[ x]\]\s*/, ''); updateBlock(b.id, e.target.checked ? `[x] ${t}` : t); }} />
                            <input className={`pb-input ${b.content.startsWith('[x]') ? 'pb-checked' : ''}`} value={b.content.replace(/^\[[ x]\]\s*/, '')} placeholder="To-do"
                              onChange={e => updateBlock(b.id, (b.content.startsWith('[x]') ? '[x] ' : '') + e.target.value)} {...common} />
                          </div>
                        ) : b.type === 'quote' ? <textarea className="pb-textarea pb-quote" rows={2} value={b.content} placeholder="Quote" onChange={e => updateBlock(b.id, e.target.value)} onInput={e => autoGrow(e.target)} {...common} />
                        : b.type === 'code' ? <textarea className="pb-textarea pb-code" rows={3} value={b.content} placeholder="// code" onChange={e => updateBlock(b.id, e.target.value)} onInput={e => autoGrow(e.target)} {...common} />
                        : b.type === 'callout' ? (
                          <div className="pb-callout"><span>💡</span><input className="pb-input" value={b.content} placeholder="Callout" onChange={e => updateBlock(b.id, e.target.value)} {...common} /></div>
                        ) : <textarea className="pb-textarea" rows={1} value={b.content} placeholder="Write a description… (Enter for a new line block)" onChange={e => updateBlock(b.id, e.target.value)} onInput={e => autoGrow(e.target)} {...common} />}
                    </div>
                  );
                })}
              </div>
              <button className="tp-open-full" onClick={onOpenFull}>Open the full editor ↗</button>

              <div className="tp-subtasks">
                <div className="tp-sub-head"><span>Subtasks</span><span>{doneSubs}/{subtasks.length} done</span></div>
                {subtasks.map(s => (
                  <label key={s.id} className={`tp-sub ${s.status === 'Completed' ? 'done' : ''}`}>
                    <input type="checkbox" className="pb-check" checked={s.status === 'Completed'} onChange={() => toggleSub(s)} disabled={!canEdit} />
                    <span>{s.title}</span>
                  </label>
                ))}
                {canEdit && (
                  <div className="tp-sub-add">
                    <input className="input" style={{ padding: '6px 10px', fontSize: '.84rem' }} placeholder="Add a subtask and press Enter" value={subInput}
                      onChange={e => setSubInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } }} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Discussion ── */}
          {tab === 'discussion' && (
            <div className="tp-tabpanel">
              <div className="tp-editor">
                <textarea ref={draftRef} value={draft} onChange={e => setDraft(e.target.value)}
                  placeholder="Write a comment… use @Name to mention someone"
                  onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') publish(); }} />
                <div className="tp-editor-bar">
                  <div className="tp-fmt">
                    <button title="Bold" onClick={() => wrapSel('**')}><b>B</b></button>
                    <button title="Italic" onClick={() => wrapSel('_')}><i>I</i></button>
                    <button title="Underline" onClick={() => wrapSel('__')}><u>U</u></button>
                    <button title="Strikethrough" onClick={() => wrapSel('~~')}><s>S</s></button>
                  </div>
                  <div className="tp-editor-right">
                    <div className="tp-emoji-wrap">
                      <button title="Emoji" onClick={() => setShowEmoji(!showEmoji)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                      </button>
                      {showEmoji && (
                        <div className="tp-emoji-pop animate-in">
                          {QUICK_EMOJI.map(em => <button key={em} onClick={() => { insertAtCursor(em); setShowEmoji(false); }}>{em}</button>)}
                        </div>
                      )}
                    </div>
                    <button title="Link" onClick={addLink}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                    </button>
                    <button className="tp-publish" onClick={publish} disabled={!draft.trim() || posting}>{posting ? 'Posting…' : 'Publish'}</button>
                  </div>
                </div>
              </div>
              <div className="tp-suggest">
                <span>Suggestion response:</span>
                {SUGGESTIONS.map(s => <button key={s} onClick={() => { setDraft(s); draftRef.current?.focus(); }}>{s}</button>)}
              </div>

              <div className="tp-comments">
                {comments.length === 0 && <p className="tp-empty">No comments yet — start the discussion.</p>}
                {[...comments].reverse().map(c => (
                  <div className="tp-comment" key={c.id}>
                    <Avatar name={c.author} members={teamMembers} size={30} />
                    <div className="tp-comment-body">
                      <div className="tp-comment-head">
                        <b>{c.author}</b><span className="tp-muted">· {relTime(c.createdAt)}</span>
                        {(c.author === currentUser?.name || isAdmin) && (
                          <button className="tp-comment-del" title="Delete comment" onClick={() => removeComment(c.id)}>×</button>
                        )}
                      </div>
                      <p className="tp-comment-text">{renderRich(c.text)}</p>
                      <div className="tp-reactions">
                        <div className="tp-react-wrap">
                          <button className="tp-react-add" title="React" onClick={() => setReactFor(reactFor === c.id ? null : c.id)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                          </button>
                          {reactFor === c.id && (
                            <div className="tp-emoji-pop animate-in">{QUICK_EMOJI.map(em => <button key={em} onClick={() => react(c.id, em)}>{em}</button>)}</div>
                          )}
                        </div>
                        {(c.reactions || []).map(r => (
                          <button key={r.emoji} className={`tp-react ${r.users?.includes(currentUser?.name) ? 'mine' : ''}`}
                            onClick={() => react(c.id, r.emoji)} title={(r.users || []).join(', ')}>
                            {r.emoji} <span>{r.users?.length || 0}</span>
                          </button>
                        ))}
                        <button className="tp-reply" onClick={() => reply(c)}>Reply</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Attachments ── */}
          {tab === 'attachments' && (
            <div className="tp-tabpanel">
              <div className="tp-att-head">
                <span className="tp-muted">{attachments.length} file{attachments.length === 1 ? '' : 's'}</span>
                {canEdit && (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      {uploading ? 'Uploading…' : '+ Add files'}
                    </button>
                    <input ref={fileRef} type="file" multiple hidden onChange={onFiles} />
                  </>
                )}
              </div>
              {uploadError && <p className="tp-error">{uploadError}</p>}
              {attachments.length === 0 && <p className="tp-empty">No attachments yet.</p>}
              {attachments.map(att => {
                const live = att.path && !att.path.startsWith('blob:');
                return (
                  <div className="tp-att" key={att.id}>
                    <FileTypeIcon name={att.name} size={22} />
                    <div className="tp-att-info">
                      {live
                        ? <span className="tp-att-name" title="Preview" onClick={() => setPreviewAtt(att)}>{att.name}</span>
                        : <span className="tp-att-name" style={{ cursor: 'default', color: 'var(--text-muted)' }}>{att.name} (unavailable)</span>}
                      <span className="tp-att-size">{formatSize(att.sizeBytes)}{att.addedAt ? ` · ${relTime(att.addedAt)}` : ''}</span>
                    </div>
                    {live && (
                      <button className="btn-icon" title="Download" onClick={() => downloadAtt(att)} style={{ width: 28, height: 28 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </button>
                    )}
                    {canEdit && (
                      <button className="btn-icon" title="Remove" onClick={() => removeAtt(att.id)} style={{ width: 28, height: 28 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {previewAtt && <FilePreviewModal attachment={previewAtt} onClose={() => setPreviewAtt(null)} onDownload={() => downloadAtt(previewAtt)} />}
    </>
  );
}
