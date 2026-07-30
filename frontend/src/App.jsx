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

function AppContent() {
  const { user } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const { toasts, addToast, removeToast } = useToast();

  useEffect(() => {
    const handleNav = () => setActivePage('tasks');
    window.addEventListener('NAVIGATE_TO_TASK', handleNav);
    return () => window.removeEventListener('NAVIGATE_TO_TASK', handleNav);
  }, []);

  if (!user) return <AuthPage />;

  return (
    <>
      <Layout activePage={activePage} onNavigate={setActivePage} onToast={addToast}>
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
