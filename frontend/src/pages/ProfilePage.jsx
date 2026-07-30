import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { uploadAvatar, updateUser } from '../api';
import './ProfilePage.css';

export default function ProfilePage() {
  const { user, loginUser, logout } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const fileRef = useRef(null);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadAvatar(user._id, file);
      loginUser({ ...user, profilePictureUrl: res.data.profilePictureUrl });
    } catch (err) { console.error('Upload failed:', err); }
    finally { setUploading(false); }
  };

  const handleNameSave = async () => {
    if (!name.trim()) return;
    try {
      const res = await updateUser(user._id, { name });
      loginUser({ ...user, name: res.data.name });
      setEditName(false);
    } catch (err) { console.error(err); }
  };

  return (
    <div className="profile-page">
      <div className="profile-card animate-in">
        <div className="profile-header-section">
          <div className="profile-avatar-lg" onClick={() => fileRef.current?.click()} style={{ cursor: 'pointer', position: 'relative' }}>
            {user?.profilePictureUrl ? (
              <img src={user.profilePictureUrl} alt={user.name} />
            ) : (
              <span>{user?.name?.charAt(0)?.toUpperCase()}</span>
            )}
            <div className="avatar-overlay">
              {uploading ? (
                <div className="spinner" style={{ width: 20, height: 20 }} />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
          </div>
          <div className="profile-info">
            {editName ? (
              <div className="profile-name-edit">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setEditName(false); }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleNameSave}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditName(false)}>Cancel</button>
              </div>
            ) : (
              <h2 onClick={() => setEditName(true)} style={{ cursor: 'pointer' }} title="Click to edit">
                {user?.name}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 8, opacity: 0.4 }}>
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </h2>
            )}
            <p className="profile-email">{user?.email}</p>
            <span className={`badge ${user?.role === 'Admin' ? 'badge-admin' : 'badge-member'}`}>
              {user?.role}
            </span>
          </div>
        </div>

        <div className="profile-details">
          <div className="profile-field">
            <label className="label">Full Name</label>
            <div className="profile-value">{user?.name}</div>
          </div>
          <div className="profile-field">
            <label className="label">Email Address</label>
            <div className="profile-value">{user?.email}</div>
          </div>
          <div className="profile-field">
            <label className="label">Role</label>
            <div className="profile-value">{user?.role}</div>
          </div>
          <div className="profile-field">
            <label className="label">User ID</label>
            <div className="profile-value profile-id">{user?._id || user?.id}</div>
          </div>
        </div>

        <button className="btn btn-danger" onClick={logout} style={{ marginTop: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
      </div>
    </div>
  );
}
