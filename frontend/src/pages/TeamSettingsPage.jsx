import { useState, useEffect } from 'react';
import { getTeam, inviteUser, removeUser } from '../api';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { useTeamspace } from '../context/TeamspaceContext';

const ROLES = ['Admin', 'Manager', 'Lead', 'Developer', 'Designer', 'Member', 'Viewer'];

export default function TeamSettingsPage() {
  const { user } = useAuth();
  const { isManagement, getOrgRole, getManagerChain } = useOrg();
  const { activeTeamspaceId } = useTeamspace();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState('Member');
  const [search, setSearch] = useState('');

  const refresh = () => {
    setLoading(true);
    getTeam().then(res => { setMembers(res.data); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    try {
      await inviteUser(invEmail, invRole, user?.name || 'Admin');
      setShowInvite(false);
      setInvEmail(''); setInvRole('Member');
      refresh();
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to invite');
    }
  };

  const handleRemove = async (id, name) => {
    if (!confirm(`Remove ${name} from the team?`)) return;
    try {
      await removeUser(id);
      refresh();
    } catch { alert('Failed to remove'); }
  };

  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase()) ||
    (m.role || '').toLowerCase().includes(search.toLowerCase())
  );

  const currentUserIsAdmin = user?.role === 'Admin' || isManagement(user?._id);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>⚙️ Team Settings</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '4px 0 0' }}>Manage team roles, permissions, and invitations</p>
        </div>
        {currentUserIsAdmin && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowInvite(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Invite Member
          </button>
        )}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <input className="input" placeholder="Search members..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      {/* Settings Table */}
      {loading ? (
        <div className="tasks-loading"><div className="spinner" style={{ width: 28, height: 28 }} /></div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Email</th>
                <th>System Role</th>
                <th>Org Title</th>
                <th>Reports To</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const orgRole = getOrgRole(m._id);
                const chain = getManagerChain(m._id);
                const reportsTo = chain.length > 0 ? chain[0] : null;
                return (
                  <tr key={m._id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0 }}>
                          {m.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{m.email}</td>
                    <td>
                      <span className={`badge ${m.role === 'Admin' ? 'badge-admin' : 'badge-member'}`} style={{ fontSize: '0.75rem' }}>
                        {m.role}
                      </span>
                    </td>
                    <td>
                      {orgRole ? (
                        <span style={{ background: 'var(--primary-tint)', color: 'var(--primary-light)', padding: '2px 10px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600 }}>{orgRole}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {reportsTo ? `${reportsTo.name} (${reportsTo.orgRole})` : '—'}
                    </td>
                    <td>
                      {currentUserIsAdmin && m._id !== user?._id && (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)', fontSize: '0.78rem' }} onClick={() => handleRemove(m._id, m.name)}>Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No members found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="modal animate-in" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📨 Invite Team Member</h2>
              <button className="btn-icon" onClick={() => setShowInvite(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleInvite} className="modal-form">
              <div className="form-field">
                <label className="label">Email Address</label>
                <input className="input" type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} placeholder="member@mayvel.com" required autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Role</label>
                <select className="input" value={invRole} onChange={e => setInvRole(e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="modal-actions">
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowInvite(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm">Send Invite</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
