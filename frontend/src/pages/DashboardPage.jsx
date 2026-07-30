import { useState, useEffect } from 'react';
import { getTasks, getSprints, getProjects, getTeam } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import TaskDetailPage from './TaskDetailPage';
import './DashboardPage.css';

const COLORS = ['#00b894', '#74b9ff', '#6c5ce7', '#ff9800', '#ff4d4d'];

export default function DashboardPage() {
  const { user } = useAuth();
  const { activeTeamspaceId } = useTeamspace();
  
  const [tasks, setTasks] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [projects, setProjects] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);

  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  useEffect(() => {
    fetchData();
  }, [activeTeamspaceId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tRes, sRes, pRes, tmRes] = await Promise.all([
        getTasks(activeTeamspaceId),
        getSprints(activeTeamspaceId),
        getProjects(activeTeamspaceId),
        getTeam()
      ]);
      setTasks(tRes.data);
      setSprints(sRes.data);
      setProjects(pRes.data);
      setTeam(tmRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loader"><div className="spinner" /></div>;

  // --- Filter Logic ---
  const filteredTasks = tasks.filter(t => {
    if (filterAssignee && t.assignee !== filterAssignee) return false;
    if (filterProject && t.projectId !== filterProject) return false;
    if (filterDateFrom && (!t.dueDate || new Date(t.dueDate) < new Date(filterDateFrom))) return false;
    if (filterDateTo && (!t.dueDate || new Date(t.dueDate) > new Date(filterDateTo))) return false;
    return true;
  });

  // --- KPI Calculation ---
  const activeProjectsCount = projects.length;
  const activeSprintsCount = sprints.filter(s => s.status === 'active').length;
  const totalTasks = filteredTasks.length;
  const completedTasks = filteredTasks.filter(t => t.status === 'Completed').length;
  const completionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Efficiency / Productivity
  let totalEstimated = 0;
  let totalActual = 0;
  filteredTasks.forEach(t => {
    totalEstimated += (t.estimatedHours || 0);
    totalActual += (t.actualHours || 0);
  });
  const efficiencyRatio = totalActual > 0 ? Math.round((totalEstimated / totalActual) * 100) : (totalEstimated > 0 ? 100 : 0);

  // --- Hot Spots & Escalations ---
  const ongoingTasks = filteredTasks.filter(t => t.status === 'In Progress');
  const rejectedTasks = filteredTasks.filter(t => t.status === 'Rejected');
  
  const highPriorityTasks = filteredTasks.filter(t => 
    (t.priority === 'Urgent' || t.priority === 'High') && t.status !== 'Completed' && t.status !== 'Rejected'
  );

  const now = new Date();
  const overdueTasks = filteredTasks.filter(t => {
    if (t.status === 'Completed' || !t.dueDate) return false;
    return new Date(t.dueDate) < now;
  });

  const overbudgetTasks = filteredTasks.filter(t => {
    if (!t.estimatedHours || !t.actualHours) return false;
    return t.actualHours > t.estimatedHours;
  });

  // --- Chart Data ---
  // Status Distribution
  const statusCounts = filteredTasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  const statusData = Object.keys(statusCounts).map(k => ({ name: k, count: statusCounts[k] }));

  // Priority Breakdown
  const priorityCounts = filteredTasks.reduce((acc, t) => {
    const p = t.priority || 'Unassigned';
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  const priorityData = Object.keys(priorityCounts).map(k => ({ name: k, value: priorityCounts[k] }));

  const sprintData = sprints.map(s => {
    const sprintTasks = tasks.filter(t => t.sprintId === s._id || t.sprintId === s.id);
    return {
      name: s.name,
      Total: sprintTasks.length,
      Completed: sprintTasks.filter(t => t.status === 'Completed').length
    };
  }).slice(0, 5); // top 5 sprints

  // --- Team Performance Score Card ---
  const memberPerformance = Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean))).map(name => {
    const memberTasks = tasks.filter(t => t.assignee === name);
    const completed = memberTasks.filter(t => t.status === 'Completed');
    const overdue = completed.filter(t => t.dueDate && new Date(t.dueDate) < new Date(t.completedDate || t.updatedDate));
    
    let est = 0, act = 0;
    completed.forEach(t => { est += (t.estimatedHours || 0); act += (t.actualHours || 0); });
    
    const completionRate = memberTasks.length ? Math.round((completed.length / memberTasks.length) * 100) : 0;
    const efficiency = act > 0 ? Math.round((est / act) * 100) : (est > 0 ? 100 : 0);
    const onTimeRate = completed.length ? Math.round(((completed.length - overdue.length) / completed.length) * 100) : 0;
    
    // Weighted score: 40% completion, 30% efficiency, 30% on-time
    const score = Math.round((completionRate * 0.4) + (efficiency * 0.3) + (onTimeRate * 0.3));
    
    const memberObj = team.find(m => m.name === name);
    
    return { name, completionRate, efficiency, onTimeRate, score, total: memberTasks.length, completed: completed.length, avatar: memberObj?.profilePictureUrl };
  }).sort((a, b) => b.score - a.score);

  return (
    <div className="dashboard-page animate-in">
      
      <div className="dash-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1>Executive Dashboard</h1>
          <p className="dash-subtitle">WSR / MSR Overview & Health Metrics</p>
        </div>
        
        <div className="dash-filters" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <select className="input" value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{ width: 140, padding: '6px 12px', fontSize: '0.85rem' }}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
          
          <select className="input" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{ width: 140, padding: '6px 12px', fontSize: '0.85rem' }}>
            <option value="">All Members</option>
            {Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean))).map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          <input type="date" className="input" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} style={{ width: 130, padding: '6px 12px', fontSize: '0.85rem' }} />
          <span style={{color: 'var(--text-muted)', display: 'flex', alignItems: 'center'}}>-</span>
          <input type="date" className="input" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} style={{ width: 130, padding: '6px 12px', fontSize: '0.85rem' }} />
          
          {(filterProject || filterAssignee || filterDateFrom || filterDateTo) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setFilterProject(''); setFilterAssignee(''); setFilterDateFrom(''); setFilterDateTo(''); }}>Clear</button>
          )}
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{background: 'rgba(116, 185, 255, 0.15)', color: '#74b9ff'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          </div>
          <div className="kpi-info">
            <h3>{activeProjectsCount}</h3>
            <span>Total Projects</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{background: 'rgba(108, 92, 231, 0.15)', color: '#6c5ce7'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>
          </div>
          <div className="kpi-info">
            <h3>{activeSprintsCount}</h3>
            <span>Active Sprints</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{background: 'rgba(0, 184, 148, 0.15)', color: '#00b894'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div className="kpi-info">
            <h3>{completionRate}%</h3>
            <span>Task Completion</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{background: 'rgba(255, 77, 77, 0.15)', color: '#ff4d4d'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div className="kpi-info">
            <h3>{overdueTasks.length}</h3>
            <span>Overdue Tasks</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{background: 'rgba(255, 152, 0, 0.15)', color: '#ff9800'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div className="kpi-info">
            <h3>{efficiencyRatio}%</h3>
            <span>Time Efficiency</span>
          </div>
        </div>
      </div>

      <div className="performance-section" style={{ marginTop: '32px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '16px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Team Member Performance Score Card
        </h3>
        <div className="performance-grid">
          {memberPerformance.map((perf, i) => (
            <div className="perf-card animate-in" key={perf.name} style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="perf-card-header">
                <div className="perf-avatar">
                  {perf.avatar ? <img src={perf.avatar} alt={perf.name} /> : perf.name.charAt(0).toUpperCase()}
                </div>
                <div className="perf-user-info">
                  <h4>{perf.name}</h4>
                  <span>{perf.completed} / {perf.total} Tasks Done</span>
                </div>
                <div className="perf-score" style={{ color: perf.score > 80 ? '#00b894' : perf.score > 50 ? '#ff9800' : '#ff4d4d' }}>
                  {perf.score}
                </div>
              </div>
              <div className="perf-metrics">
                <div className="perf-metric">
                  <div className="perf-metric-label"><span>Efficiency</span><span>{perf.efficiency}%</span></div>
                  <div className="perf-progress"><div className="perf-progress-fill" style={{ width: `${Math.min(perf.efficiency, 100)}%`, background: '#74b9ff' }} /></div>
                </div>
                <div className="perf-metric">
                  <div className="perf-metric-label"><span>On-Time</span><span>{perf.onTimeRate}%</span></div>
                  <div className="perf-progress"><div className="perf-progress-fill" style={{ width: `${perf.onTimeRate}%`, background: '#00b894' }} /></div>
                </div>
                <div className="perf-metric">
                  <div className="perf-metric-label"><span>Completion</span><span>{perf.completionRate}%</span></div>
                  <div className="perf-progress"><div className="perf-progress-fill" style={{ width: `${perf.completionRate}%`, background: '#6c5ce7' }} /></div>
                </div>
              </div>
            </div>
          ))}
          {memberPerformance.length === 0 && <div className="perf-empty">No performance data available yet.</div>}
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <h3>Task Status Distribution</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} />
                <YAxis stroke="var(--text-muted)" fontSize={12} />
                <RechartsTooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-main)' }} />
                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="chart-card">
          <h3>Sprint Performance (Burndown preview)</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sprintData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} />
                <YAxis stroke="var(--text-muted)" fontSize={12} />
                <RechartsTooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-main)' }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                <Line type="monotone" dataKey="Total" stroke="#74b9ff" strokeWidth={3} />
                <Line type="monotone" dataKey="Completed" stroke="#00b894" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="chart-card">
          <h3>Task Priority Breakdown</h3>
          <div className="chart-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={priorityData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {priorityData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <RechartsTooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-main)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="alerts-grid">
        <div className="alert-card danger">
          <div className="alert-header">
            <h3>🚨 Hot Spots (High/Urgent Open Tasks)</h3>
            <span className="badge badge-danger">{highPriorityTasks.length}</span>
          </div>
          <div className="alert-list">
            {highPriorityTasks.slice(0,5).map(t => (
              <div key={t._id} className="alert-item clickable-row" onClick={() => setSelectedTask(t)}>
                <span className="alert-title">{t.title}</span>
                <span className="alert-meta">{t.assignee || 'Unassigned'} • {t.priority}</span>
              </div>
            ))}
            {highPriorityTasks.length === 0 && <p className="alert-empty">No hot spots detected.</p>}
          </div>
        </div>

        <div className="alert-card warning">
          <div className="alert-header">
            <h3>⚠️ Escalations & Rejected</h3>
            <span className="badge badge-warning">{rejectedTasks.length}</span>
          </div>
          <div className="alert-list">
            {rejectedTasks.slice(0,5).map(t => (
              <div key={t._id} className="alert-item clickable-row" onClick={() => setSelectedTask(t)}>
                <span className="alert-title">{t.title}</span>
                <span className="alert-meta">{t.assignee || 'Unassigned'}</span>
              </div>
            ))}
            {rejectedTasks.length === 0 && <p className="alert-empty">No escalations currently.</p>}
          </div>
        </div>

        <div className="alert-card info">
          <div className="alert-header">
            <h3>⏱️ Efficiency Alerts (Extra Hours)</h3>
            <span className="badge badge-info">{overbudgetTasks.length}</span>
          </div>
          <div className="alert-list">
            {overbudgetTasks.slice(0,5).map(t => (
              <div key={t._id} className="alert-item clickable-row" onClick={() => setSelectedTask(t)}>
                <span className="alert-title">{t.title}</span>
                <span className="alert-meta" style={{color: '#ff9800', fontWeight: 600}}>{t.actualHours}h / {t.estimatedHours}h est.</span>
              </div>
            ))}
            {overbudgetTasks.length === 0 && <p className="alert-empty">All tasks within estimated limits.</p>}
          </div>
        </div>
      </div>

      <div className="ongoing-tasks-section" style={{ marginTop: '32px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '16px', color: 'var(--text-main)' }}>Ongoing Team Tasks ({ongoingTasks.length})</h3>
        <div className="table-responsive">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Task Name</th>
                <th>Assignee</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>Efficiency</th>
              </tr>
            </thead>
            <tbody>
              {ongoingTasks.slice(0, 10).map(t => (
                <tr key={t._id} onClick={() => setSelectedTask(t)} className="clickable-row">
                  <td style={{ fontWeight: 500 }}>{t.title}</td>
                  <td>{t.assignee || <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}</td>
                  <td><span className={`badge badge-${t.priority?.toLowerCase() || 'default'}`}>{t.priority || 'None'}</span></td>
                  <td><span className={`badge badge-progress`}>{t.status}</span></td>
                  <td>{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '-'}</td>
                  <td>{t.estimatedHours > 0 ? `${t.actualHours || 0} / ${t.estimatedHours}h` : '-'}</td>
                </tr>
              ))}
              {ongoingTasks.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>No ongoing tasks currently.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <div style={{height: 40}}></div>

      {selectedTask && (
        <TaskDetailPage 
          task={selectedTask} 
          onClose={() => { setSelectedTask(null); fetchData(); }} 
        />
      )}
    </div>
  );
}
