import { useState, useEffect, useRef, useCallback } from 'react';
import { getTeam, getOrgChart, saveOrgChart } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import { useOrg } from '../context/OrgContext';
import { MAYVEL_ORG_CHART, CHART_VERSION } from '../data/mayvelOrgChart';
import './OrgChartPage.css';

const ROLE_COLORS = {
  'Founder':      { bg: 'var(--bg-card)', border: '#8a63d2', text: 'var(--text)' },
  'CEO':          { bg: 'var(--bg-card)', border: '#8a63d2', text: 'var(--text)' },
  'CTO':          { bg: 'var(--bg-card)', border: '#0d9488', text: 'var(--text)' },
  'COO':          { bg: 'var(--bg-card)', border: '#2e9e6b', text: 'var(--text)' },
  'CFO':          { bg: 'var(--bg-card)', border: '#b7791f', text: 'var(--text)' },
  'Director':     { bg: 'var(--bg-card)', border: '#2383e2', text: 'var(--text)' },
  'Manager':      { bg: 'var(--bg-card)', border: '#8a63d2', text: 'var(--text)' },
  'Lead':         { bg: 'var(--bg-card)', border: '#2383e2', text: 'var(--text)' },
  'Designer':     { bg: 'var(--bg-card)', border: '#c14c8a', text: 'var(--text)' },
  'Developer':    { bg: 'var(--bg-card)', border: '#2e9e6b', text: 'var(--text)' },
  'Consultant':   { bg: 'var(--bg-card)', border: '#b7791f', text: 'var(--text)' },
  'Intern':       { bg: 'var(--bg-card)', border: '#9b9a97', text: 'var(--text-secondary)' },
  'Marketing':    { bg: 'var(--bg-card)', border: '#d9730d', text: 'var(--text)' },
  'Member':       { bg: 'var(--bg-card)', border: '#9b9a97', text: 'var(--text-secondary)' },
  'Admin':        { bg: 'var(--bg-card)', border: '#2e9e6b', text: 'var(--text)' },
  'Team Owner':   { bg: 'var(--bg-card)', border: '#8a63d2', text: 'var(--text)' },
  'default':      { bg: 'var(--bg-card)', border: '#9b9a97', text: 'var(--text-secondary)' },
};

const getNodeColor = (node) => {
  const r = node.orgRole || node.role || 'default';
  for (const key of Object.keys(ROLE_COLORS)) {
    if (r.toLowerCase().includes(key.toLowerCase())) return ROLE_COLORS[key];
  }
  return ROLE_COLORS.default;
};

const ORG_ROLES = ['Founder', 'CEO', 'COO', 'CTO', 'CFO', 'Director', 'Manager', 'Lead', 'Senior Developer', 'Developer', 'Designer', 'Marketing', 'Sales', 'HR', 'Support', 'Intern', 'Consultant'];

const genId = () => `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export default function OrgChartPage() {
  const canvasRef = useRef(null);
  const { user } = useAuth();
  const { activeTeamspaceId } = useTeamspace();
  const { refresh: refreshOrgContext } = useOrg();
  const [members, setMembers] = useState([]);
  const [chart, setChart] = useState({ nodes: [], edges: [] });
  const [selected, setSelected] = useState(null);
  const [editNode, setEditNode] = useState(null);
  const [showAddNode, setShowAddNode] = useState(null);
  const [zoom, setZoom] = useState(0.55);
  const [pan, setPan] = useState({ x: 20, y: 10 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef(null);
  const dragging = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');  // '', 'saved', 'error'
  const [loadingChart, setLoadingChart] = useState(true);

  // New node form
  const [newName, setNewName] = useState('');
  const [newOrgRole, setNewOrgRole] = useState('Member');
  const [newDept, setNewDept] = useState('');
  const [newMemberId, setNewMemberId] = useState('');

  // Load team members
  useEffect(() => {
    getTeam().then(res => setMembers(res.data)).catch(() => {});
  }, []);

  // Load chart from backend on mount / teamspace change
  useEffect(() => {
    setLoadingChart(true);
    getOrgChart(activeTeamspaceId || '')
      .then(res => {
        const data = res.data;
        if (data && data.nodes && data.nodes.length > 0) {
          setChart({ nodes: data.nodes, edges: data.edges || [] });
        } else {
          // No chart in DB → seed with default Mayvel chart
          setChart(MAYVEL_ORG_CHART);
          setHasChanges(true); // mark as needing save
        }
      })
      .catch(() => {
        setChart(MAYVEL_ORG_CHART);
        setHasChanges(true);
      })
      .finally(() => setLoadingChart(false));
  }, [activeTeamspaceId]);

  // Also persist to localStorage as backup
  useEffect(() => {
    localStorage.setItem('mayvel_orgchart', JSON.stringify(chart));
  }, [chart]);

  const updateChart = (newChart) => {
    setChart(newChart);
    setHasChanges(true);
    setSaveStatus('');
  };

  // ─── Save to Backend ──────────────────────────────────────────────────────────
  const handleSaveToBackend = async () => {
    setSaving(true);
    setSaveStatus('');
    try {
      await saveOrgChart({
        nodes: chart.nodes,
        edges: chart.edges,
        teamspaceId: activeTeamspaceId || null,
        updatedBy: user?.name || '',
      });
      setHasChanges(false);
      setSaveStatus('saved');
      // Refresh global OrgContext so role management updates everywhere
      refreshOrgContext();
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      console.error('Failed to save org chart:', err);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Adding Nodes ────────────────────────────────────────────────────────────
  const handleAddChild = (parentId) => {
    setShowAddNode(parentId);
    setNewName(''); setNewOrgRole('Member'); setNewDept(''); setNewMemberId('');
  };

  const confirmAdd = () => {
    if (!newName.trim()) return;
    const parent = chart.nodes.find(n => n.id === showAddNode);
    const newId = genId();
    const sibs = chart.edges.filter(e => e.from === showAddNode).length;
    const x = parent ? parent.x + sibs * 180 : 400;
    const y = parent ? parent.y + 130 : 200;
    const memberObj = members.find(m => m._id === newMemberId);
    const newNode = {
      id: newId,
      name: memberObj ? memberObj.name : newName.trim(),
      orgRole: newOrgRole,
      department: newDept.trim(),
      memberId: newMemberId || null,
      x, y, w: 160, h: 72,
    };
    const newEdge = showAddNode !== 'STANDALONE' ? { id: genId(), from: showAddNode, to: newId } : null;
    updateChart({
      nodes: [...chart.nodes, newNode],
      edges: newEdge ? [...chart.edges, newEdge] : chart.edges,
    });
    setShowAddNode(null);
  };

  // ─── Edit ─────────────────────────────────────────────────────────────────────
  const openEdit = (node) => {
    setEditNode({ ...node });
    setSelected(node.id);
  };

  const saveEdit = () => {
    updateChart({ ...chart, nodes: chart.nodes.map(n => n.id === editNode.id ? { ...editNode } : n) });
    setEditNode(null);
  };

  // ─── Delete ───────────────────────────────────────────────────────────────────
  const deleteNode = (id) => {
    // Remove node and all its edges, recursively remove orphaned children
    const removeIds = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      chart.edges.forEach(e => {
        if (removeIds.has(e.from) && !removeIds.has(e.to)) {
          removeIds.add(e.to); changed = true;
        }
      });
    }
    updateChart({
      nodes: chart.nodes.filter(n => !removeIds.has(n.id)),
      edges: chart.edges.filter(e => !removeIds.has(e.from) && !removeIds.has(e.to)),
    });
    setSelected(null);
  };

  // ─── Duplicate ────────────────────────────────────────────────────────────────
  const duplicateNode = (node) => {
    const newId = genId();
    const newNode = { ...node, id: newId, x: node.x + 20, y: node.y + 20 };
    // find parent edge
    const parentEdge = chart.edges.find(e => e.to === node.id);
    const newEdge = parentEdge ? { id: genId(), from: parentEdge.from, to: newId } : null;
    updateChart({
      nodes: [...chart.nodes, newNode],
      edges: newEdge ? [...chart.edges, newEdge] : chart.edges,
    });
  };

  // ─── Move (re-parent) ─────────────────────────────────────────────────────────
  const reparent = (nodeId, newParentId) => {
    if (nodeId === newParentId) return;
    const edges = chart.edges.filter(e => !(e.to === nodeId));
    if (newParentId) edges.push({ id: genId(), from: newParentId, to: nodeId });
    updateChart({ ...chart, edges });
  };

  // ─── Drag Nodes ───────────────────────────────────────────────────────────────
  const handleMouseDown = (e, nodeId) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = chart.nodes.find(n => n.id === nodeId);
    dragging.current = nodeId;
    dragOffset.current = {
      x: (e.clientX - pan.x) / zoom - node.x,
      y: (e.clientY - pan.y) / zoom - node.y,
    };
    setSelected(nodeId);
  };

  const handleMouseMove = useCallback((e) => {
    if (dragging.current) {
      const nx = (e.clientX - pan.x) / zoom - dragOffset.current.x;
      const ny = (e.clientY - pan.y) / zoom - dragOffset.current.y;
      setChart(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => n.id === dragging.current ? { ...n, x: nx, y: ny } : n),
      }));
      setHasChanges(true);
      setSaveStatus('');
    } else if (isPanning && panStart.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      panStart.current = { x: e.clientX, y: e.clientY };
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    }
  }, [pan, zoom, isPanning]);

  const handleMouseUp = useCallback(() => {
    dragging.current = null;
    setIsPanning(false);
    panStart.current = null;
  }, []);

  const handleCanvasMouseDown = (e) => {
    if (e.button === 1 || e.button === 0) {
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      setSelected(null);
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    setZoom(z => Math.max(0.2, Math.min(2.5, z * factor)));
  };

  // ─── Edge drawing ─────────────────────────────────────────────────────────────
  const getEdgePath = (fromNode, toNode) => {
    if (!fromNode || !toNode) return '';
    const fx = fromNode.x + fromNode.w / 2;
    const fy = fromNode.y + fromNode.h;
    const tx = toNode.x + toNode.w / 2;
    const ty = toNode.y;
    const my = (fy + ty) / 2;
    return `M${fx},${fy} C${fx},${my} ${tx},${my} ${tx},${ty}`;
  };

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const nodeMap = Object.fromEntries(chart.nodes.map(n => [n.id, n]));

  if (loadingChart) return <div className="tasks-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;

  return (
    <div className="orgchart-page">
      {/* Toolbar */}
      <div className="orgchart-toolbar">
        <div className="orgchart-toolbar-left">
          <span className="tasks-count">{chart.nodes.length} nodes</span>

          {/* ── SAVE BUTTON ── */}
          <button
            className={`btn btn-sm ${hasChanges ? 'btn-primary orgchart-save-pulse' : 'btn-ghost'}`}
            onClick={handleSaveToBackend}
            disabled={saving || !hasChanges}
            title={hasChanges ? 'Save changes to server' : 'No changes to save'}
          >
            {saving ? (
              <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>
                {hasChanges ? 'Save Chart' : 'Saved'}
              </>
            )}
          </button>

          {saveStatus === 'saved' && <span className="orgchart-save-msg orgchart-save-ok animate-in">✓ Saved & applied to roles</span>}
          {saveStatus === 'error' && <span className="orgchart-save-msg orgchart-save-err animate-in">✗ Failed to save</span>}
          {hasChanges && !saving && <span className="orgchart-unsaved-dot" title="Unsaved changes" />}

          <button className="btn btn-ghost btn-sm" onClick={() => handleAddChild('STANDALONE')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Node
          </button>
          <button className="btn btn-ghost btn-sm" onClick={resetView}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1018 0 9 9 0 00-18 0M12 8v4l3 3"/></svg>
            Reset View
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('Reset chart to Mayvel default? Your changes will be lost.')) { setChart(MAYVEL_ORG_CHART); setHasChanges(true); setSaveStatus(''); setZoom(0.55); setPan({ x: 20, y: 10 }); } }}>
            🏢 Load Company Chart
          </button>
        </div>
        <div className="orgchart-toolbar-right">
          <button className="btn btn-ghost btn-sm" onClick={() => setZoom(z => Math.min(2.5, z * 1.2))}>+</button>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setZoom(z => Math.max(0.2, z * 0.83))}>−</button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="orgchart-canvas"
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          className="orgchart-world"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
        >
          {/* Edges SVG */}
          <svg className="orgchart-svg" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#555" />
              </marker>
            </defs>
            {chart.edges.map(edge => {
              const from = nodeMap[edge.from];
              const to = nodeMap[edge.to];
              if (!from || !to) return null;
              return (
                <path
                  key={edge.id}
                  d={getEdgePath(from, to)}
                  stroke="#444"
                  strokeWidth="1.5"
                  fill="none"
                  strokeDasharray="none"
                  markerEnd="url(#arrowhead)"
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {chart.nodes.map(node => {
            const colors = getNodeColor(node);
            const isSel = selected === node.id;
            return (
              <div
                key={node.id}
                className={`org-node ${isSel ? 'org-node-selected' : ''}`}
                style={{
                  left: node.x, top: node.y, width: node.w, minHeight: node.h,
                  background: colors.bg,
                  borderColor: isSel ? colors.border : 'var(--border)',
                  boxShadow: isSel ? `0 0 0 2px ${colors.border}40, var(--shadow-md)` : 'var(--shadow-sm)',
                }}
                onMouseDown={(e) => handleMouseDown(e, node.id)}
                onClick={(e) => { e.stopPropagation(); setSelected(node.id); }}
                onDoubleClick={(e) => { e.stopPropagation(); openEdit(node); }}
              >
                <div className="org-node-role" style={{ color: colors.border }}>{node.orgRole}</div>
                <div className="org-node-name" style={{ color: colors.text }}>{node.name}</div>
                {node.department && <div className="org-node-dept">{node.department}</div>}

                {/* Action buttons (shown on hover/select) */}
                <div className="org-node-actions" onClick={e => e.stopPropagation()}>
                  <button title="Add child" className="org-action-btn" onClick={() => handleAddChild(node.id)}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                  <button title="Edit" className="org-action-btn" onClick={() => openEdit(node)}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button title="Duplicate" className="org-action-btn" onClick={() => duplicateNode(node)}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  </button>
                  <button title="Delete" className="org-action-btn org-action-del" onClick={() => deleteNode(node.id)}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Add Node Modal ─── */}
      {showAddNode && (
        <div className="modal-overlay" onClick={() => setShowAddNode(null)}>
          <div className="modal animate-in" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🏗️ Add {showAddNode === 'STANDALONE' ? 'Node' : 'Child Node'}</h2>
              <button className="btn-icon" onClick={() => setShowAddNode(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-form">
              <div className="form-field">
                <label className="label">Link to Team Member (optional)</label>
                <select className="input" value={newMemberId} onChange={e => {
                  const m = members.find(m => m._id === e.target.value);
                  setNewMemberId(e.target.value);
                  if (m) { setNewName(m.name); setNewOrgRole(m.role || 'Member'); }
                }}>
                  <option value="">— Custom / No member —</option>
                  {members.map(m => <option key={m._id} value={m._id}>{m.name} ({m.role})</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="label">Display Name *</label>
                <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Thaha Naseer" autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Role / Title</label>
                <select className="input" value={newOrgRole} onChange={e => setNewOrgRole(e.target.value)}>
                  {ORG_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="label">Department</label>
                <input className="input" value={newDept} onChange={e => setNewDept(e.target.value)} placeholder="e.g. Engineering, Design..." />
              </div>
              <div className="modal-actions">
                <div style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAddNode(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={confirmAdd} disabled={!newName.trim()}>Add Node</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit Node Modal ─── */}
      {editNode && (
        <div className="modal-overlay" onClick={() => setEditNode(null)}>
          <div className="modal animate-in" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>✏️ Edit Node</h2>
              <button className="btn-icon" onClick={() => setEditNode(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-form">
              <div className="form-field">
                <label className="label">Link to Team Member</label>
                <select className="input" value={editNode.memberId || ''} onChange={e => {
                  const m = members.find(m => m._id === e.target.value);
                  setEditNode(prev => ({ ...prev, memberId: e.target.value || null, name: m ? m.name : prev.name }));
                }}>
                  <option value="">— Custom —</option>
                  {members.map(m => <option key={m._id} value={m._id}>{m.name} ({m.role})</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="label">Display Name</label>
                <input className="input" value={editNode.name} onChange={e => setEditNode(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="form-field">
                <label className="label">Role / Title</label>
                <select className="input" value={editNode.orgRole} onChange={e => setEditNode(prev => ({ ...prev, orgRole: e.target.value }))}>
                  {ORG_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="label">Department</label>
                <input className="input" value={editNode.department || ''} onChange={e => setEditNode(prev => ({ ...prev, department: e.target.value }))} placeholder="e.g. Engineering, Design..." />
              </div>
              <div className="form-field">
                <label className="label">Move under (re-parent)</label>
                <select className="input" value={chart.edges.find(e => e.to === editNode.id)?.from || ''} onChange={e => reparent(editNode.id, e.target.value || null)}>
                  <option value="">— No parent (root) —</option>
                  {chart.nodes.filter(n => n.id !== editNode.id).map(n => (
                    <option key={n.id} value={n.id}>{n.name} ({n.orgRole})</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button className="btn btn-ghost btn-sm" style={{ marginRight: 'auto', color: 'var(--color-danger)' }} onClick={() => { deleteNode(editNode.id); setEditNode(null); }}>Delete Node</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditNode(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Legend ─── */}
      <div className="orgchart-legend">
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>Legend</span>
        {Object.entries(ROLE_COLORS).slice(0, 8).map(([role, c]) => (
          <div key={role} className="orgchart-legend-item">
            <span className="orgchart-legend-dot" style={{ background: c.border }} />
            <span>{role}</span>
          </div>
        ))}
        <div style={{ marginTop: 12, fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <div>🖱 Drag to move</div>
          <div>🖱 Scroll to zoom</div>
          <div>↔ Middle-click pan</div>
          <div>✏ Double-click edit</div>
        </div>
      </div>
    </div>
  );
}
