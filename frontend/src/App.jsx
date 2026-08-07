import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { useToast, ToastContainer } from './components/Toast';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import ProjectsPage from './pages/ProjectsPage';
import WorkflowsPage from './pages/WorkflowsPage';
import SprintsPage from './pages/SprintsPage';
import TeamPage from './pages/TeamPage';
import ProfilePage from './pages/ProfilePage';
import OrgChartPage from './pages/OrgChartPage';
import TeamSettingsPage from './pages/TeamSettingsPage';
import TeamspaceControlPage from './pages/TeamspaceControlPage';
import Layout from './components/Layout';

const PAGES = ['dashboard', 'tasks', 'projects', 'sprints', 'workflows', 'team', 'organization', 'team-settings', 'teamspace-control', 'profile'];
const pageFromHash = () => {
  const p = window.location.hash.replace(/^#\/?/, '');
  return PAGES.includes(p) ? p : 'dashboard';
};

function AppContent() {
  const { user } = useAuth();
  // The URL hash is the source of truth for the active page, so a reload
  // (or browser back/forward) lands on the same page instead of the dashboard.
  const [activePage, setActivePage] = useState(pageFromHash);
  const { toasts, addToast, removeToast } = useToast();

  const navigate = (page) => {
    if (!PAGES.includes(page)) return;
    setActivePage(page);
    if (window.location.hash !== `#/${page}`) window.location.hash = `/${page}`;
  };

  useEffect(() => {
    const onHash = () => setActivePage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const handleNav = () => navigate('tasks');
    window.addEventListener('NAVIGATE_TO_TASK', handleNav);
    return () => window.removeEventListener('NAVIGATE_TO_TASK', handleNav);
  }, []);

  if (!user) return <AuthPage />;

  return (
    <>
      <Layout activePage={activePage} onNavigate={navigate} onToast={addToast}>
        {activePage === 'dashboard' && <DashboardPage />}
        {activePage === 'tasks'     && <TasksPage />}
        {activePage === 'projects'  && <ProjectsPage />}
        {activePage === 'sprints'   && <SprintsPage />}
        {activePage === 'workflows' && <WorkflowsPage />}
        {activePage === 'team'              && <TeamPage />}
        {activePage === 'organization'       && <OrgChartPage />}
        {activePage === 'team-settings'      && <TeamSettingsPage />}
        {activePage === 'teamspace-control'  && <TeamspaceControlPage />}
        {activePage === 'profile'            && <ProfilePage />}
      </Layout>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}

import { TeamspaceProvider } from './context/TeamspaceContext';
import { OrgProvider } from './context/OrgContext';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <TeamspaceProvider>
          <OrgProvider>
            <AppContent />
          </OrgProvider>
        </TeamspaceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
