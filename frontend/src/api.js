import axios from 'axios';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000/api' });

// Attach the session token to every request
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('mayvel_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401 (expired/invalid session) clear the session and return to the login page
API.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem('mayvel_token')) {
      localStorage.removeItem('mayvel_token');
      localStorage.removeItem('mayvel_user');
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

// Auth — Microsoft SSO only
export const loginWithMicrosoft = (idToken) => API.post('/auth/microsoft', { idToken });
export const getMe = () => API.get('/auth/me');

// Tasks
export const getTasks = (tsId) => API.get('/tasks' + (tsId ? `?teamspaceId=${tsId}` : ''));
export const createTask = (task) => API.post('/tasks', task);
export const updateTask = (id, task) => API.put(`/tasks/${id}`, task);
export const deleteTask = (id) => API.delete(`/tasks/${id}`);
export const uploadTaskAttachments = (taskId, files) => {
  const formData = new FormData();
  files.forEach((f) => formData.append('attachments', f));
  return API.post(`/tasks/${taskId}/attachments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};
// Attachments are auth-gated — fetch as a blob through the API (which carries
// the session token), then hand the blob to the browser to save.
export const downloadAttachmentBlob = (key) =>
  API.get(`/files/attachments/${key}`, { responseType: 'blob' });

// Team
export const getTeam = () => API.get('/team');
export const removeUser = (id) => API.delete(`/team/${id}`);
export const inviteUser = (email, role, inviterName) => API.post('/team/invite', { email, role, inviterName });
export const getMergeCandidates = () => API.get('/team/merge-candidates');
export const mergeUsers = (payload) => API.post('/team/merge', payload);

// Projects
export const getProjects = (tsId) => API.get('/projects' + (tsId ? `?teamspaceId=${tsId}` : ''));
export const createProject = (project) => API.post('/projects', project);
export const updateProject = (id, project) => API.put(`/projects/${id}`, project);
export const deleteProject = (id) => API.delete(`/projects/${id}`);

// Notion
export const syncNotionSprints = (data) => API.post('/sprints/notion/sync', data);

// Sprints
export const getSprints = (params) => {
  // If a string is passed, assume it's teamspaceId for backward compatibility
  const query = typeof params === 'string' ? { teamspaceId: params } : params;
  return API.get('/sprints', { params: query || {} });
};
export const getSprint   = (id) => API.get(`/sprints/${id}`);
export const createSprint = (sprint) => API.post('/sprints', sprint);
export const updateSprint = (id, data) => API.put(`/sprints/${id}`, data);
export const deleteSprint = (id) => API.delete(`/sprints/${id}`);
export const startSprint  = (id) => API.post(`/sprints/${id}/start`);
export const completeSprint = (id, rolloverSprintId) => API.post(`/sprints/${id}/complete`, { rolloverSprintId });
export const addTaskToSprint    = (sprintId, taskId) => API.post(`/sprints/${sprintId}/tasks`, { taskId });
export const removeTaskFromSprint = (sprintId, taskId) => API.delete(`/sprints/${sprintId}/tasks/${taskId}`);

// Pages
export const getPages    = () => API.get('/pages');
export const getPage     = (id) => API.get(`/pages/${id}`);
export const createPage  = (page) => API.post('/pages', page);
export const updatePage  = (id, page) => API.put(`/pages/${id}`, page);
export const deletePage  = (id) => API.delete(`/pages/${id}`);

// Profile
export const updateUser = (id, data) => API.put(`/users/${id}`, data);
export const uploadAvatar = (id, file) => {
  const formData = new FormData();
  formData.append('avatar', file);
  return API.post(`/users/${id}/avatar`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

// Notifications (filtered by user name)
export const getNotifications = (userName) => API.get('/notifications', { params: { user: userName } });
export const getUnreadCount = (userName) => API.get('/notifications/unread-count', { params: { user: userName } });
export const markNotificationRead = (id) => API.put(`/notifications/${id}/read`);
export const markAllNotificationsRead = (userName) => API.post('/notifications/mark-all-read', { user: userName });
export const deleteNotification = (id) => API.delete(`/notifications/${id}`);

// Workflows
export const getWorkflows = () => API.get('/workflows');
export const createWorkflow = (wf) => API.post('/workflows', wf);
export const updateWorkflow = (id, wf) => API.put(`/workflows/${id}`, wf);
export const deleteWorkflow = (id) => API.delete(`/workflows/${id}`);
export const toggleWorkflow = (id) => API.post(`/workflows/${id}/toggle`);
export const getWorkflowLogs = (id) => API.get(`/workflows/${id}/logs`);
export const getAllWorkflowLogs = () => API.get('/workflow-logs');
export const runWorkflow = (id, taskId) => API.post(`/workflows/${id}/run`, { taskId });

export default API;

export const getTeamspaces = () => API.get('/teamspaces');
export const createTeamspace = (data) => API.post('/teamspaces', data);
export const updateTeamspace = (id, data) => API.put(`/teamspaces/${id}`, data);
export const deleteTeamspace = (id) => API.delete(`/teamspaces/${id}`);

// Org Chart
export const getOrgChart = (teamspaceId) => API.get('/orgchart', { params: teamspaceId ? { teamspaceId } : {} });
export const saveOrgChart = (data) => API.put('/orgchart', data);
export const getOrgHierarchy = (memberId, teamspaceId) => API.get(`/orgchart/hierarchy/${memberId}`, { params: teamspaceId ? { teamspaceId } : {} });
