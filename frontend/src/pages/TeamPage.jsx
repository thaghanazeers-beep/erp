import { useState, useEffect, useRef } from 'react';
import { getTeam, inviteUser, removeUser, updateUser, uploadAvatar, getMergeCandidates, mergeUsers } from '../api';
import { useAuth } from '../context/AuthContext';
import ViewTabs from '../components/ViewTabs';
import './TeamPage.css';

const ROLES = ['Member', 'Admin', 'Team Owner'];

export default function TeamPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin' || user?.role === 'Team Owner';
  const canMerge = user?.role === 'Admin';

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [views, setViews] = useState(() => {
    const saved = localStorage.getItem('team_views');
    return saved ? JSON.parse(saved) : [
      { id: 'v1', type: 'grid', name: 'Cards' },
      { id: 'v2', type: 'list', name: 'List' },
      { id: 'v3', type: 'table', name: 'Table' },
    ];
  });
  const [activeViewId, setActiveViewId] = useState(views[0]?.id || 'v1');
  const viewType = views.find(v => v.id === activeViewId)?.type || 'grid';

  useEffect(() => {
    localStorage.setItem('team_views', JSON.stringify(views));
  }, [views]);

  const handleAddView = (type, label) => {
    const newId = `v${Date.now()}`;
    const newViews = [...views, { id: newId, type, name: label }];
    setViews(newViews);
    setActiveViewId(newId);
  };

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Member');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);

  // Merge modal
  const [showMerge, setShowMerge] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState(null); // { users, orphans }
  const [mergeSource, setMergeSource] = useState(''); // "user:<id>" or "name:<assignee>"
  const [mergeTarget, setMergeTarget] = useState(''); // user id
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState(null);

  // Edit modal
  const [editMember, setEditMember] = useState(null); // member object being edited
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');
  const avatarInputRef = useRef(null);

  useEffect(() => { fetchTeam(); }, []);

  const fetchTeam = async () => {
    try {
      const res = await getTeam();
      setMembers(res.data);
    } catch (err) {
      console.error('Failed to load team:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Invite ──────────────────────────────────────────────
  const handleInvite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await inviteUser(email, role, user?.name);
      setInviteResult({ success: true, message: res.data.message, tempPassword: res.data.tempPassword, emailSent: res.data.emailSent });
      setEmail('');
      setRole('Member');
      fetchTeam();
    } catch (err) {
      setInviteResult({ success: false, message: err.response?.data?.message || 'Failed to invite user' });
    } finally {
      setInviting(false);
    }
  };

  // ── Remove ──────────────────────────────────────────────
  const handleRemove = async (id) => {
    if (!confirm('Remove this member from the workspace?')) return;
    try {
      await removeUser(id);
      fetchTeam();
    } catch (err) {
      console.error('Failed to remove:', err);
    }
  };

  // ── Merge Users ─────────────────────────────────────────
  const openMerge = async () => {
    setShowMerge(true);
    setMergeSource('');
    setMergeTarget('');
    setMergeResult(null);
    try {
      const res = await getMergeCandidates();
      setMergeCandidates(res.data);
    } catch (err) {
      setMergeResult({ success: false, message: err.response?.data?.message || 'Failed to load users' });
    }
  };

  const selectedSource = (() => {
    if (!mergeSource || !mergeCandidates) return null;
    if (mergeSource.startsWith('user:')) {
      const u = mergeCandidates.users.find(x => x._id === mergeSource.slice(5));
      return u ? { kind: 'user', label: `${u.name} (${u.email})`, name: u.name, taskCount: u.taskCount, id: u._id } : null;
    }
    const name = mergeSource.slice(5);
    const o = mergeCandidates.orphans.find(x => x.name === name);
    return o ? { kind: 'name', label: o.name, name: o.name, taskCount: o.taskCount } : null;
  })();
  const selectedTarget = mergeCandidates?.users.find(u => u._id === mergeTarget) || null;

  const handleMerge = async (e) => {
    e.preventDefault();
    if (!selectedSource || !selectedTarget) return;
    const summary = selectedSource.kind === 'user'
      ? `Merge "${selectedSource.label}" into "${selectedTarget.name} (${selectedTarget.email})"?\n\nAll their tasks, notifications, teamspace memberships and org chart entries move to ${selectedTarget.name}, and the duplicate account is permanently deleted. This cannot be undone.`
      : `Reassign everything under the name "${selectedSource.name}" to "${selectedTarget.name} (${selectedTarget.email})"?\n\nThis cannot be undone.`;
    if (!confirm(summary)) return;
    setMerging(true);
    setMergeResult(null);
    try {
      const payload = selectedSource.kind === 'user'
        ? { sourceUserId: selectedSource.id, targetUserId: mergeTarget }
        : { sourceName: selectedSource.name, targetUserId: mergeTarget };
      const res = await mergeUsers(payload);
      const s = res.data.stats || {};
      setMergeResult({
        success: true,
        message: `Merged "${res.data.source}" into "${res.data.target}" — ${s.tasksReassigned || 0} tasks reassigned${s.accountDeleted ? ', duplicate account removed' : ''}.`,
      });
      setMergeSource('');
      setMergeTarget('');
      fetchTeam();
      const cand = await getMergeCandidates();
      setMergeCandidates(cand.data);
    } catch (err) {
      setMergeResult({ success: false, message: err.response?.data?.message || err.response?.data?.error || 'Merge failed' });
    } finally {
      setMerging(false);
    }
  };

  // ── Open Edit Modal ─────────────────────────────────────
  const openEdit = (member) => {
    setEditMember(member);
    setEditName(member.name);
    setEditEmail(member.email);
    setEditRole(member.role);
    setEditPassword('');
    setEditError('');
    setEditSuccess('');
  };

  // ── Save Profile Changes ────────────────────────────────
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editName.trim() || !editEmail.trim()) return;
    setEditSaving(true);
    setEditError('');
    setEditSuccess('');
    try {
      const payload = { name: editName.trim(), email: editEmail.trim(), role: editRole };
      if (editPassword.trim()) payload.password = editPassword.trim();
      await updateUser(editMember._id, payload);
      setEditSuccess('Profile updated successfully!');
      fetchTeam();
      // Update local member in state immediately
      setEditMember(prev => ({ ...prev, name: editName, email: editEmail, role: editRole }));
    } catch (err) {
      setEditError(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Avatar Upload ────────────────────────────────────────
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditError('');
    try {
      const res = await uploadAvatar(editMember._id, file);
      setEditMember(prev => ({ ...prev, profilePictureUrl: res.data.profilePictureUrl }));
      setEditSuccess('Profile picture updated!');
      fetchTeam();
    } catch (err) {
      setEditError('Failed to upload avatar');
    }
  };

  if (loading) {
    return <div className="tasks-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;
  }

  return (
    <div className="team-page">
      <ViewTabs 
        views={views} 
        activeViewId={activeViewId} 
        onChangeView={setActiveViewId} 
        onAddView={handleAddView} 
      />

      <div className="team-toolbar" style={{ paddingTop: 0 }}>
        <span className="tasks-count">{members.length} members</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canMerge && (
            <button className="btn btn-ghost btn-sm" onClick={openMerge}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 009 9"/></svg>
              Merge Users
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={() => { setShowInvite(true); setInviteResult(null); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Invite User
            </button>
          )}
        </div>
      </div>

      {/* Grid (Cards) View */}
      {viewType === 'grid' && (
        <div className="team-grid">
          {members.map((member, i) => (
            <div className="team-card animate-in" key={member._id} style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="team-card-top">
                <div className="team-avatar">
                  {member.profilePictureUrl ? (
                    <img src={member.profilePictureUrl} alt={member.name} />
                  ) : (
                    <span>{member.name?.charAt(0)?.toUpperCase()}</span>
                  )}
                </div>
                {isAdmin && (
                  <div className="team-card-actions">
                    <button className="btn-icon team-edit" onClick={() => openEdit(member)} title="Edit member">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    {member._id !== user?.id && (
                      <button className="btn-icon team-remove" onClick={() => handleRemove(member._id)} title="Remove member">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <h3 className="team-name">{member.name}</h3>
              <p className="team-email">{member.email}</p>
              <span className={`badge ${member.role === 'Admin' ? 'badge-admin' : member.role === 'Team Owner' ? 'badge-owner' : 'badge-member'}`}>
                {member.role}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {viewType === 'list' && (
        <div className="list-view">
          {members.map((member, i) => (
            <div className="list-item animate-in" key={member._id} style={{ animationDelay: `${i * 0.03}s` }}>
              <div className="list-item-left" style={{ gap: 12 }}>
                <div className="team-avatar" style={{ width: 32, height: 32, fontSize: 13, flexShrink: 0 }}>
                  {member.profilePictureUrl ? <img src={member.profilePictureUrl} alt={member.name} /> : <span>{member.name?.charAt(0)?.toUpperCase()}</span>}
                </div>
                <span className="list-item-title">{member.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{member.email}</span>
              </div>
              <div className="list-item-right">
                <span className={`badge ${member.role === 'Admin' ? 'badge-admin' : member.role === 'Team Owner' ? 'badge-owner' : 'badge-member'}`}>{member.role}</span>
                {isAdmin && (
                  <div className="team-card-actions" style={{ marginLeft: 8 }}>
                    <button className="btn-icon team-edit" onClick={() => openEdit(member)} title="Edit" style={{ width: 28, height: 28 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table View */}
      {viewType === 'table' && (
        <div className="table-wrapper">
          <table className="task-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th>{isAdmin && <th>Actions</th>}</tr>
            </thead>
            <tbody>
              {members.map((member, i) => (
                <tr key={member._id} className="animate-in" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="team-avatar" style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>
                      {member.profilePictureUrl ? <img src={member.profilePictureUrl} alt={member.name} /> : <span>{member.name?.charAt(0)?.toUpperCase()}</span>}
                    </div>
                    {member.name}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{member.email}</td>
                  <td><span className={`badge ${member.role === 'Admin' ? 'badge-admin' : member.role === 'Team Owner' ? 'badge-owner' : 'badge-member'}`}>{member.role}</span></td>
                  {isAdmin && (
                    <td>
                      <button className="btn-icon team-edit" onClick={() => openEdit(member)} title="Edit" style={{ width: 28, height: 28 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* ─── Merge Users Modal ─── */}
      {showMerge && (
        <div className="modal-overlay" onClick={() => setShowMerge(false)}>
          <div className="modal animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Merge Users</h2>
              <button className="btn-icon" onClick={() => setShowMerge(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleMerge} className="modal-form">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                Combine a duplicate account or a stray assignee name into one user.
                Tasks, notifications, teamspaces and org chart entries all move to the user you keep.
              </p>

              <div className="form-field">
                <label className="label">Duplicate to merge (source)</label>
                <select className="input" value={mergeSource} onChange={(e) => setMergeSource(e.target.value)} required disabled={!mergeCandidates}>
                  <option value="">{mergeCandidates ? 'Select duplicate…' : 'Loading…'}</option>
                  {mergeCandidates?.users.length > 0 && (
                    <optgroup label="Accounts">
                      {mergeCandidates.users.map(u => (
                        <option key={u._id} value={`user:${u._id}`} disabled={u._id === user?.id}>
                          {u.name} ({u.email}){u.active === false ? ' — deactivated' : ''} · {u.taskCount} tasks
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {mergeCandidates?.orphans.length > 0 && (
                    <optgroup label="Assignee names without an account">
                      {mergeCandidates.orphans.map(o => (
                        <option key={o.name} value={`name:${o.name}`}>
                          {o.name} · {o.taskCount} tasks
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="form-field">
                <label className="label">Merge into (kept)</label>
                <select className="input" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} required disabled={!mergeCandidates}>
                  <option value="">Select user to keep…</option>
                  {mergeCandidates?.users
                    .filter(u => u.active !== false && `user:${u._id}` !== mergeSource)
                    .map(u => (
                      <option key={u._id} value={u._id}>{u.name} ({u.email})</option>
                    ))}
                </select>
              </div>

              {selectedSource && selectedTarget && (
                <div className="merge-preview">
                  <span className="merge-preview-name">{selectedSource.label}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  <span className="merge-preview-name merge-preview-target">{selectedTarget.name}</span>
                  <span className="merge-preview-count">{selectedSource.taskCount} tasks move{selectedSource.kind === 'user' ? ', duplicate account deleted' : ''}</span>
                </div>
              )}

              {mergeResult && (
                <div className={`invite-result ${mergeResult.success ? 'invite-success' : 'invite-error'}`}>
                  <p>{mergeResult.message}</p>
                </div>
              )}

              <div className="modal-actions">
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMerge(false)}>Close</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={merging || !selectedSource || !selectedTarget}>
                  {merging ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Merge'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Edit Member Modal ─── */}
      {editMember && (
        <div className="modal-overlay" onClick={() => setEditMember(null)}>
          <div className="modal modal-wide animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Member Profile</h2>
              <button className="btn-icon" onClick={() => setEditMember(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="edit-member-body">
              {/* Avatar section */}
              <div className="edit-avatar-section">
                <div className="edit-avatar-preview">
                  {editMember.profilePictureUrl ? (
                    <img src={editMember.profilePictureUrl} alt={editMember.name} />
                  ) : (
                    <span>{editMember.name?.charAt(0)?.toUpperCase()}</span>
                  )}
                </div>
                <div className="edit-avatar-actions">
                  <p className="edit-avatar-name">{editMember.name}</p>
                  <p className="edit-avatar-email">{editMember.email}</p>
                  <button className="btn btn-ghost btn-sm" onClick={() => avatarInputRef.current?.click()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Change Photo
                  </button>
                  <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleSaveEdit} className="edit-member-form">
                <div className="edit-form-row">
                  <div className="form-field">
                    <label className="label">Full Name</label>
                    <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Full name" required />
                  </div>
                  <div className="form-field">
                    <label className="label">Email Address</label>
                    <input className="input" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email@mayvel.ai" required />
                  </div>
                </div>
                <div className="edit-form-row">
                  <div className="form-field">
                    <label className="label">Role</label>
                    <select className="input" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="label">New Password <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(leave blank to keep current)</span></label>
                    <input className="input" type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
                  </div>
                </div>

                {editError && <div className="invite-result invite-error"><p>{editError}</p></div>}
                {editSuccess && <div className="invite-result invite-success"><p>✓ {editSuccess}</p></div>}

                <div className="modal-actions">
                  <div style={{ flex: 1 }} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditMember(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={editSaving}>
                    {editSaving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─── Invite Modal ─── */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="modal animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Invite User</h2>
              <button className="btn-icon" onClick={() => setShowInvite(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleInvite} className="modal-form">
              <div className="form-field">
                <label className="label">Email Address</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" required autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Role</label>
                <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {inviteResult && (
                <div className={`invite-result ${inviteResult.success ? 'invite-success' : 'invite-error'}`}>
                  <p>{inviteResult.message}</p>
                  {inviteResult.success && inviteResult.tempPassword && (
                    <div className="invite-credentials">
                      <p><strong>Temporary Password:</strong></p>
                      <code className="invite-password">{inviteResult.tempPassword}</code>
                      <p className="invite-hint">
                        {inviteResult.emailSent ? '✓ Credentials sent via email' : '⚠ Email not configured. Share the password manually.'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="modal-actions">
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowInvite(false)}>Close</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={inviting}>
                  {inviting ? <span className="spinner" /> : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
