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

export default function ViewTabs({ views, activeViewId, onAddView, onChangeView }) {
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setShowPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="view-tabs-container">
      <div className="view-tabs-list">
        {views.map(v => (
          <button 
            key={v.id} 
            className={`view-tab ${activeViewId === v.id ? 'active' : ''}`}
            onClick={() => onChangeView(v.id)}
          >
            <span className="view-tab-icon">{VIEW_OPTIONS.find(o => o.id === v.type)?.icon || '☰'}</span>
            {v.name}
          </button>
        ))}
        
        <div className="view-add-wrapper" ref={popoverRef}>
          <button className="view-add-btn" onClick={() => setShowPopover(!showPopover)}>+</button>
          
          {showPopover && (
            <div className="view-popover animate-in">
              <div className="view-popover-header">Add a new view</div>
              <div className="view-popover-grid">
                {VIEW_OPTIONS.map(opt => (
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
