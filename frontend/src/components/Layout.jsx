import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useTeamspace } from '../context/TeamspaceContext';
import NotificationBell from './NotificationBell';
import { getTeamspaces, createTeamspace } from '../api';
import './Layout.css';

export default function Layout({ children, activePage, onNavigate, onToast }) {
  const { user, logout } = useAuth();
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || 'dark';
  const toggleTheme = themeCtx?.toggleTheme || (() => {});
  const { activeTeamspaceId, setActiveTeamspaceId } = useTeamspace();

  const [teamspaces, setTeamspaces] = useState([]);
  const [expandedTs, setExpandedTs] = useState({});  // { tsId: true/false }
  const [tsMenu, setTsMenu] = useState(null);         // tsId for context menu
  const menuRef = useRef(null);
  const [showTsModal, setShowTsModal] = useState(false);
  const [tsName, setTsName] = useState('');
  const [tsType, setTsType] = useState('org'); // 'org' or 'personal'

  useEffect(() => { fetchTeamspaces(); }, []);

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setTsMenu(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchTeamspaces = async () => {
    try {
      const res = await getTeamspaces();
      setTeamspaces(res.data);
      if (res.data.length > 0 && !activeTeamspaceId) {
        setActiveTeamspaceId(res.data[0]._id);
      }
      // Auto-expand active teamspace
      const exp = {};
      res.data.forEach(ts => { exp[ts._id] = true; });
      setExpandedTs(prev => ({ ...exp, ...prev }));
    } catch (e) {
      console.error('Failed to load teamspaces', e);
    }
  };

  const handleCreateTs = async (e) => {
    e.preventDefault();
    try {
      const res = await createTeamspace({ 
        name: tsName, 
        ownerId: user._id,
        isPersonal: tsType === 'personal'
      });
      await fetchTeamspaces();
      setActiveTeamspaceId(res.data._id);
      setExpandedTs(prev => ({ ...prev, [res.data._id]: true }));
      setShowTsModal(false);
      setTsName('');
      setTsType('org');
      if (onToast) onToast('Teamspace created successfully', 'success');
    } catch (e) {
      if (onToast) onToast('Failed to create teamspace', 'error');
    }
  };

  const toggleExpand = (tsId) => setExpandedTs(prev => ({ ...prev, [tsId]: !prev[tsId] }));

  const selectTsAndNav = (tsId, page) => {
    setActiveTeamspaceId(tsId);
    onNavigate(page);
  };

  // Check if a page under a specific teamspace is active
  const isTsChildActive = (tsId, page) => activeTeamspaceId === tsId && activePage === page;

  // Items nested under each teamspace
  const tsChildItems = [
    { id: 'sprints',           label: 'Sprints',           icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg> },
    { id: 'projects',          label: 'Projects',          icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg> },
    { id: 'tasks',             label: 'Tasks',             icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
    { id: 'workflows',         label: 'Workflows',         icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8l4 4-4 4M8 12h8"/></svg> },
    { id: 'team',              label: 'Team Members',      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg> },
    { id: 'team-settings',     label: 'Team Settings',     icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00-.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg> },
    { id: 'teamspace-control', label: 'Teamspace Control', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> },
  ];

  // Personal teamspace only gets basic items (no team mgmt)
  const personalChildItems = [
    tsChildItems[0], // Sprints
    tsChildItems[1], // Projects
    tsChildItems[2], // Tasks
    tsChildItems[3], // Workflows
  ];

  const PERSONAL_TS_ID = '__personal__';
  const isPersonalActive = activeTeamspaceId === '' || activeTeamspaceId === PERSONAL_TS_ID;
  const personalExpanded = expandedTs[PERSONAL_TS_ID] !== false; // default open
  const isPersonalChildActive = (page) => isPersonalActive && activePage === page;

  const pageTitles = {
    dashboard: 'Dashboard', tasks: 'Tasks', projects: 'Projects', sprints: 'Sprints',
    workflows: 'Workflows', team: 'Team Members', organization: 'Organization',
    'team-settings': 'Team Settings', 'teamspace-control': 'Teamspace Control', profile: 'Profile',
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="2"/><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <span className="sidebar-title">Mayvel</span>
        </div>

        <nav className="sidebar-nav">
          {/* ─── Dashboard (always visible) ─── */}
          <button className={`sidebar-link ${activePage === 'dashboard' ? 'active' : ''}`} onClick={() => onNavigate('dashboard')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            <span>Dashboard</span>
          </button>

          {/* ═══════════════════════════════════════════════
              TEAMSPACES — collapsible tree, Notion-style
             ═══════════════════════════════════════════════ */}
          <div className="sidebar-section-row">
            <span className="sidebar-section-label">Teamspaces</span>
            <button className="sidebar-section-btn" onClick={() => setShowTsModal(true)} title="New Teamspace">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>

          {/* ─── Personal Teamspace (always first, no org chart) ─── */}
          <div className="ts-tree-group">
            <div className={`ts-tree-header ${isPersonalActive ? 'ts-active' : ''}`}>
              <button className="ts-tree-chevron" onClick={() => setExpandedTs(prev => ({ ...prev, [PERSONAL_TS_ID]: !personalExpanded }))}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: personalExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}><polyline points="9,6 15,12 9,18"/></svg>
              </button>
              <button className="ts-tree-name" onClick={() => { setActiveTeamspaceId(''); setExpandedTs(prev => ({ ...prev, [PERSONAL_TS_ID]: true })); }}>
                <span className="ts-tree-icon">🏠</span>
                <span className="ts-tree-label">Personal</span>
              </button>
            </div>
            {personalExpanded && (
              <div className="ts-tree-children">
                {personalChildItems.map(item => (
                  <button
                    key={item.id}
                    className={`sidebar-link sidebar-link-child ${isPersonalChildActive(item.id) ? 'active' : ''}`}
                    onClick={() => { setActiveTeamspaceId(''); onNavigate(item.id); }}
                  >
                    {item.icon}<span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ─── User-created Teamspaces ─── */}
          {teamspaces.map(ts => {
            const isOpen = expandedTs[ts._id];
            const isActiveTs = activeTeamspaceId === ts._id;
            return (
              <div key={ts._id} className="ts-tree-group">
                <div className={`ts-tree-header ${isActiveTs ? 'ts-active' : ''}`}>
                  <button className="ts-tree-chevron" onClick={() => toggleExpand(ts._id)} title={isOpen ? 'Collapse' : 'Expand'}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}><polyline points="9,6 15,12 9,18"/></svg>
                  </button>
                  <button className="ts-tree-name" onClick={() => { setActiveTeamspaceId(ts._id); setExpandedTs(prev => ({ ...prev, [ts._id]: true })); }}>
                    <span className="ts-tree-icon">{ts.isPersonal ? '👤' : (ts.icon || '🏢')}</span>
                    <span className="ts-tree-label">{ts.name}</span>
                  </button>
                  <button className="ts-tree-menu-btn" onClick={(e) => { e.stopPropagation(); setTsMenu(tsMenu === ts._id ? null : ts._id); }} title="Teamspace options">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                  </button>

                  {tsMenu === ts._id && (
                    <div className="ts-context-menu" ref={menuRef}>
                      <button onClick={() => { setTsMenu(null); selectTsAndNav(ts._id, 'team'); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
                        Add members
                      </button>
                      <button onClick={() => { setTsMenu(null); selectTsAndNav(ts._id, 'team-settings'); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00-.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                        Teamspace settings
                      </button>
                      <button onClick={() => { setTsMenu(null); selectTsAndNav(ts._id, 'teamspace-control'); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                        Teamspace control
                      </button>
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="ts-tree-children">
                    {tsChildItems.map(item => (
                      <button
                        key={item.id}
                        className={`sidebar-link sidebar-link-child ${isTsChildActive(ts._id, item.id) ? 'active' : ''}`}
                        onClick={() => selectTsAndNav(ts._id, item.id)}
                      >
                        {item.icon}<span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* ═══ Company ═══ */}
          <div className="sidebar-section-row" style={{ marginTop: 12 }}>
            <span className="sidebar-section-label">Company</span>
          </div>

          <button className={`sidebar-link ${activePage === 'organization' ? 'active' : ''}`} onClick={() => onNavigate('organization')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="2" width="8" height="5" rx="1"/><rect x="1" y="15" width="7" height="5" rx="1"/><rect x="16" y="15" width="7" height="5" rx="1"/><path d="M12 7v4M5.5 15v-1a6.5 6.5 0 0113 0v1"/></svg>
            <span>Organization</span>
          </button>

          <button className={`sidebar-link ${activePage === 'profile' ? 'active' : ''}`} onClick={() => onNavigate('profile')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Profile</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-link theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <button className="sidebar-link logout-btn" onClick={logout}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="header">
          <div className="header-left">
            <h2 className="page-title">{pageTitles[activePage] || ''}</h2>
          </div>
          <div className="header-right">
            <NotificationBell onToast={onToast} />
            <span className="header-user-name">{user?.name}</span>
            <span className={`badge ${user?.role === 'Admin' ? 'badge-admin' : 'badge-member'}`}>{user?.role}</span>
            <div className="header-avatar" onClick={() => onNavigate('profile')} style={{ cursor: 'pointer' }}>
              {user?.profilePictureUrl ? <img src={user.profilePictureUrl} alt={user.name} /> : <span>{user?.name?.charAt(0)?.toUpperCase()}</span>}
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      {showTsModal && (
        <div className="modal-overlay" onClick={() => setShowTsModal(false)} style={{ zIndex: 9999 }}>
          <div className="modal animate-in" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Teamspace</h2>
              <button className="btn-icon" onClick={() => setShowTsModal(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleCreateTs} className="modal-form">
              <div className="form-field">
                <label className="label">Teamspace Name</label>
                <input className="input" placeholder="e.g. Engineering, Marketing..." value={tsName} onChange={e => setTsName(e.target.value)} required autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Teamspace Type</label>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <label style={{ flex: 1, cursor: 'pointer' }}>
                    <input type="radio" name="tsType" value="org" checked={tsType === 'org'} onChange={e => setTsType(e.target.value)} style={{ display: 'none' }} />
                    <div className={`type-option ${tsType === 'org' ? 'active' : ''}`} style={{
                      padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', textAlign: 'center',
                      background: tsType === 'org' ? 'rgba(108, 92, 231, 0.1)' : 'transparent',
                      borderColor: tsType === 'org' ? 'var(--primary)' : 'var(--border)'
                    }}>
                      <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>🏢</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Organization</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Visible in Org Chart</div>
                    </div>
                  </label>
                  <label style={{ flex: 1, cursor: 'pointer' }}>
                    <input type="radio" name="tsType" value="personal" checked={tsType === 'personal'} onChange={e => setTsType(e.target.value)} style={{ display: 'none' }} />
                    <div className={`type-option ${tsType === 'personal' ? 'active' : ''}`} style={{
                      padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', textAlign: 'center',
                      background: tsType === 'personal' ? 'rgba(0, 184, 148, 0.1)' : 'transparent',
                      borderColor: tsType === 'personal' ? 'var(--accent-green)' : 'var(--border)'
                    }}>
                      <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>👤</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Personal</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Private to you</div>
                    </div>
                  </label>
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: 24 }}>
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={() => setShowTsModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
