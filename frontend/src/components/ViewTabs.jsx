import { useState, useRef, useEffect } from 'react';
import './ViewTabs.css';

const I = (d) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
const VIEW_OPTIONS = [
  { id: 'board',    label: 'Kanban',    icon: I(<><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/></>) },
  { id: 'calendar', label: 'Calendar',  icon: I(<><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>) },
  { id: 'timeline', label: 'Timeline',  icon: I(<><line x1="3" y1="7" x2="11" y2="7"/><line x1="8" y1="12" x2="19" y2="12"/><line x1="5" y1="17" x2="15" y2="17"/></>) },
  { id: 'list',     label: 'List',      icon: I(<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>) },
  { id: 'table',    label: 'Table',     icon: I(<><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/></>) },
  { id: 'gallery',  label: 'Gallery',   icon: '⊞' },
  { id: 'grid',     label: 'Grid',      icon: '⋮' },
  { id: 'orgchart', label: 'Org Chart', icon: '🏢' },
];

export default function ViewTabs({ views, activeViewId, onAddView, onChangeView, onRenameView, onDeleteView, allowedTypes }) {
  const [showPopover, setShowPopover] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const popoverRef = useRef(null);

  const options = allowedTypes ? VIEW_OPTIONS.filter(o => allowedTypes.includes(o.id)) : VIEW_OPTIONS;

  useEffect(() => {
    const handler = (e) => { if (popoverRef.current && !popoverRef.current.contains(e.target)) setShowPopover(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRenameView?.(renamingId, renameValue);
    setRenamingId(null);
  };

  return (
    <div className="view-tabs-container">
      <div className="view-tabs-list">
        {views.map(v => (
          renamingId === v.id ? (
            <input
              key={v.id}
              className="view-tab-rename"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
            />
          ) : (
            <button
              key={v.id}
              className={`view-tab ${activeViewId === v.id ? 'active' : ''}`}
              onClick={() => onChangeView(v.id)}
              onDoubleClick={() => { if (onRenameView) { setRenamingId(v.id); setRenameValue(v.name); } }}
              title={onRenameView ? 'Double-click to rename' : undefined}
            >
              <span className="view-tab-icon">{VIEW_OPTIONS.find(o => o.id === v.type)?.icon || '☰'}</span>
              {v.name}
              {onDeleteView && views.length > 1 && activeViewId === v.id && (
                <span
                  className="view-tab-close"
                  title="Delete view"
                  onClick={(e) => { e.stopPropagation(); if (confirm(`Delete the "${v.name}" view for everyone?`)) onDeleteView(v.id); }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </span>
              )}
            </button>
          )
        ))}

        <div className="view-add-wrapper" ref={popoverRef}>
          <button className="view-add-btn" onClick={() => setShowPopover(!showPopover)} title="Add a view">+</button>

          {showPopover && (
            <div className="view-popover animate-in">
              <div className="view-popover-header">Add a new view</div>
              <div className="view-popover-grid">
                {options.map(opt => (
                  <button key={opt.id} className="view-popover-item" onClick={() => { onAddView(opt.id, opt.label); setShowPopover(false); }}>
                    <span className="view-popover-icon">{opt.icon}</span>
                    <span className="view-popover-label">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
