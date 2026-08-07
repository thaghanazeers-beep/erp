import { useState, useRef, useEffect } from 'react';
import './ViewTabs.css';

const VIEW_OPTIONS = [
  { id: 'table', icon: '☰', label: 'Table' },
  { id: 'board', icon: '◫', label: 'Board' },
  { id: 'timeline', icon: '◴', label: 'Timeline' },
  { id: 'calendar', icon: '📅', label: 'Calendar' },
  { id: 'gallery', icon: '⊞', label: 'Gallery' },
  { id: 'list', icon: '≡', label: 'List' },
  { id: 'grid', icon: '⋮', label: 'Grid' },
  { id: 'orgchart', icon: '🏢', label: 'Org Chart' },
];

export default function ViewTabs({ views, activeViewId, onAddView, onChangeView, onRenameView, onDeleteView, allowedTypes }) {
  const [showPopover, setShowPopover] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const popoverRef = useRef(null);

  const options = allowedTypes ? VIEW_OPTIONS.filter(o => allowedTypes.includes(o.id)) : VIEW_OPTIONS;

  useEffect(() => {
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setShowPopover(false);
      }
    };
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
          <button className="view-add-btn" onClick={() => setShowPopover(!showPopover)}>+</button>

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
