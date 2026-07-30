import { useState, useEffect } from 'react';
import { getTeamspaces, createTeamspace, updateTeamspace, deleteTeamspace } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';

const ICONS = ['🏢', '🚀', '🎨', '💻', '📊', '🔬', '📱', '🎯', '⚡', '🌟', '🎮', '📈', '🛠️', '🏗️', '🧪', '📝'];

export default function TeamspaceControlPage() {
  const { user } = useAuth();
  const { activeTeamspaceId, setActiveTeamspaceId } = useTeamspace();
  const [teamspaces, setTeamspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTs, setEditTs] = useState(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏢');
  const [description, setDescription] = useState('');

  const refresh = () => {
    setLoading(true);
    getTeamspaces().then(res => { setTeamspaces(res.data); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const res = await createTeamspace({ name, icon, description, ownerId: user?._id });
      setActiveTeamspaceId(res.data._id);
      setShowCreate(false);
      setName(''); setIcon('🏢'); setDescription('');
      refresh();
    } catch { alert('Failed to create teamspace'); }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      await updateTeamspace(editTs._id, { name, icon, description });
      setEditTs(null);
      setName(''); setIcon('🏢'); setDescription('');
      refresh();
    } catch { alert('Failed to update teamspace'); }
  };

  const handleDelete = async (id, tsName) => {
    if (!confirm(`Delete teamspace "${tsName}"? All data within will be unlinked.`)) return;
    try {
      await deleteTeamspace(id);
      if (activeTeamspaceId === id) setActiveTeamspaceId('');
      refresh();
    } catch { alert('Failed to delete'); }
  };

  const openEdit = (ts) => {
    setEditTs(ts);
    setName(ts.name);
    setIcon(ts.icon || '🏢');
    setDescription(ts.description || '');
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>🏗️ Teamspace Control</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '4px 0 0' }}>Create, manage, and configure teamspaces for your organization</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowCreate(true); setName(''); setIcon('🏢'); setDescription(''); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Teamspace
        </button>
      </div>

      {loading ? (
        <div className="tasks-loading"><div className="spinner" style={{ width: 28, height: 28 }} /></div>
      ) : teamspaces.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🏢</div>
          <h3 style={{ margin: '0 0 8px' }}>No Teamspaces Yet</h3>
          <p style={{ margin: '0 0 16px' }}>Create a teamspace to organize your sprints, projects, and tasks.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create First Teamspace</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {teamspaces.map(ts => {
            const isActive = activeTeamspaceId === ts._id;
            return (
              <div key={ts._id} className="card" style={{ padding: 20, border: isActive ? '2px solid var(--primary)' : '1px solid var(--border)', borderRadius: 12, position: 'relative', cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s', boxShadow: isActive ? '0 0 0 3px rgba(108,92,231,0.15)' : 'none' }} onClick={() => setActiveTeamspaceId(ts._id)}>
                {isActive && <div style={{ position: 'absolute', top: 10, right: 12, fontSize: '0.68rem', fontWeight: 700, color: 'var(--primary-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: '1.8rem' }}>{ts.icon || '🏢'}</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{ts.name}</h3>
                    {ts.description && <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{ts.description}</p>}
                  </div>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                  Created {new Date(ts.createdAt).toLocaleDateString()}
                </div>
                <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(ts)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => handleDelete(ts._id, ts.name)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreate || editTs) && (
        <div className="modal-overlay" onClick={() => { setShowCreate(false); setEditTs(null); }}>
          <div className="modal animate-in" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editTs ? '✏️ Edit Teamspace' : '🏗️ New Teamspace'}</h2>
              <button className="btn-icon" onClick={() => { setShowCreate(false); setEditTs(null); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={editTs ? handleUpdate : handleCreate} className="modal-form">
              <div className="form-field">
                <label className="label">Name *</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Engineering, Marketing..." required autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Icon</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ICONS.map(ic => (
                    <button key={ic} type="button" onClick={() => setIcon(ic)} style={{ width: 36, height: 36, borderRadius: 8, border: icon === ic ? '2px solid var(--primary)' : '1px solid var(--border)', background: icon === ic ? 'rgba(108,92,231,0.12)' : 'transparent', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-field">
                <label className="label">Description</label>
                <textarea className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of this teamspace..." rows={3} style={{ resize: 'vertical' }} />
              </div>
              <div className="modal-actions">
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowCreate(false); setEditTs(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm">{editTs ? 'Save Changes' : 'Create Teamspace'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
