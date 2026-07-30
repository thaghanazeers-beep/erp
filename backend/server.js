require('dotenv').config({ quiet: true });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const User = require('./models/User');
const { Task, PropertyDefinition } = require('./models/Task');
const Project = require('./models/Project');
const Sprint = require('./models/Sprint');
const Teamspace = require('./models/Teamspace');
const Page = require('./models/Page');
const { Workflow, WorkflowLog } = require('./models/Workflow');
const Notification = require('./models/Notification');
const OrgChart = require('./models/OrgChart');
const workflowEngine = require('./workflowEngine');
const { requireAuth, requireAdmin, issueToken } = require('./middleware/auth');
const microsoftAuth = require('./services/microsoftAuth');
const fileStore = require('./services/storage'); // S3-compatible bucket, or disk fallback

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in .env — refusing to start.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // behind Hostinger/reverse-proxy TLS termination

// ==================== SECURITY MIDDLEWARE ====================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'], // avatars (pravatar / uploaded)
      connectSrc: ["'self'", 'https://login.microsoftonline.com'], // MSAL token endpoint
      frameSrc: ['https://login.microsoftonline.com'],             // MSAL silent renew iframe
    },
  },
  // MSAL sign-in popup must be able to talk back to the opener window
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow avatar images cross-origin
}));
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many sign-in attempts, try again later.' } });
app.use('/api', globalLimiter);

// ==================== HELPERS ====================
/** Pick only allowed fields from a request body (mass-assignment protection). */
const pick = (obj, fields) => {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
};
/** Escape user input before embedding in a RegExp. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Only accept plain strings from query params (NoSQL-injection guard). */
const str = (v) => (typeof v === 'string' ? v : undefined);

// The MSAL popup navigates itself to /blank.html after Microsoft redirects back.
// The main window then needs a live reference into that popup's browsing context
// to read the auth response and close it — our COOP header (needed for the rest
// of the app) breaks exactly that link if applied here, leaving the popup stuck
// showing the response instead of closing. Strip it for this one static file only.
app.use((req, res, next) => {
  if (req.path === '/blank.html') {
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.setHeader('Cache-Control', 'no-store'); // never cache the auth redirect landing page
  }
  next();
});

// Serve uploaded files. Non-image files are forced to download rather than
// render inline, so nothing user-uploaded can ever execute in our origin.
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', (req, res, next) => {
  if (!/\.(jpe?g|png|webp|gif)$/i.test(req.path)) res.setHeader('Content-Disposition', 'attachment');
  next();
});
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));

// File upload config — files buffer in memory, then go to the file store
// (S3-compatible bucket when configured, backend/uploads/ on disk otherwise).
const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!ALLOWED_IMAGE_TYPES[file.mimetype]),
});

// Task attachments — broader types than avatars, still an allowlist.
// Deliberately excludes html/svg/js/executables: nothing uploaded may ever
// execute when served back from our origin.
const ALLOWED_ATTACHMENT_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt', '.md',
  '.zip', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mov', '.json',
]);
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) =>
    cb(null, ALLOWED_ATTACHMENT_EXTS.has(path.extname(file.originalname || '').toLowerCase())),
});

// Public avatar streaming (<img> tags can't send auth headers). Keys are
// random hex — unguessable — and only ever images.
app.get('/files/avatars/:key', async (req, res) => {
  try {
    if (!/^[a-f0-9]{32}\.(jpg|jpeg|png|webp|gif)$/.test(req.params.key)) return res.status(400).end();
    const f = await fileStore.getFile(`avatars/${req.params.key}`);
    if (!f) return res.status(404).end();
    if (f.contentType) res.setHeader('Content-Type', f.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    f.body.pipe(res);
  } catch {
    res.status(500).end();
  }
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mayvel_task_management')
  .then(() => console.log('Connected to MongoDB (Mayvel Task Management)'))
  .catch(err => console.error('MongoDB connection error:', err));

// Email transporter (configure with your SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const SERVER_URL = process.env.SERVER_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

// ==================== HELPER: Create Notification ====================
async function createNotification({ type, title, message, taskId, taskTitle, userId, actorName }) {
  try {
    const notif = new Notification({ type, title, message, taskId, taskTitle, userId, actorName });
    await notif.save();
    return notif;
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
}

// ==================== HEALTH (public) ====================
app.get('/healthz', (req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// ==================== AUTH: MICROSOFT SSO ONLY ====================
app.post('/api/auth/microsoft', authLimiter, async (req, res) => {
  try {
    if (!microsoftAuth.isConfigured()) {
      return res.status(503).json({ message: 'Microsoft SSO is not configured. Set AZURE_TENANT_ID and AZURE_CLIENT_ID in backend/.env (see SSO_SETUP.md).' });
    }
    const { idToken } = req.body;
    if (typeof idToken !== 'string' || !idToken) {
      return res.status(400).json({ message: 'idToken is required' });
    }

    const claims = await microsoftAuth.verifyMicrosoftIdToken(idToken);
    const email = String(claims.preferred_username || claims.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Microsoft account has no email claim' });
    }

    const allowedDomain = (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase();
    if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
      return res.status(403).json({ message: `Only @${allowedDomain} accounts may sign in.` });
    }

    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        name: claims.name || email.split('@')[0],
        email,
        azureOid: claims.oid,
        role: adminEmails.includes(email) ? 'Admin' : 'Member',
        profilePictureUrl: `https://i.pravatar.cc/150?u=${encodeURIComponent(email)}`,
      });
    } else {
      if (user.active === false) return res.status(403).json({ message: 'This account has been deactivated.' });
      user.azureOid = user.azureOid || claims.oid;
      if (adminEmails.includes(email) && user.role !== 'Admin') user.role = 'Admin';
    }
    user.lastLoginAt = new Date();
    await user.save();

    const token = issueToken(user);
    res.json({ token, user });
  } catch (err) {
    console.error('Microsoft SSO failed:', err.message);
    res.status(401).json({ message: 'Microsoft sign-in failed. Please try again.' });
  }
});

// Everything below this line requires a valid session token.
app.use('/api', requireAuth);

app.get('/api/auth/me', (req, res) => res.json(req.user));

// ==================== TEAMSPACE ROUTES ====================
const TEAMSPACE_FIELDS = ['name', 'description', 'icon', 'members', 'isPersonal'];

app.get('/api/teamspaces', async (req, res) => {
  try {
    const teamspaces = await Teamspace.find().populate('members.userId', 'name email profilePictureUrl').sort('-createdAt');
    res.json(teamspaces);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teamspaces', async (req, res) => {
  try {
    const { name, description, icon, isPersonal } = pick(req.body, TEAMSPACE_FIELDS);
    const ownerId = req.user._id; // owner is always the authenticated caller
    const ts = new Teamspace({
      name, description, icon,
      ownerId,
      isPersonal: !!isPersonal,
      members: [{ userId: ownerId, role: 'Admin' }],
    });
    await ts.save();
    res.status(201).json(ts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teamspaces/:id', async (req, res) => {
  try {
    const ts = await Teamspace.findById(req.params.id);
    if (!ts) return res.status(404).json({ message: 'Teamspace not found' });
    const isOwner = ts.ownerId && ts.ownerId.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'Admin') {
      return res.status(403).json({ message: 'Only the owner or an Admin can edit this teamspace' });
    }
    Object.assign(ts, pick(req.body, TEAMSPACE_FIELDS));
    await ts.save();
    res.json(ts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teamspaces/:id', requireAdmin, async (req, res) => {
  try {
    await Teamspace.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TEAM ROUTES ====================
app.get('/api/team', async (req, res) => {
  try {
    const team = await User.find({ active: { $ne: false } });
    res.json(team);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/team/:id', requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot remove yourself' });
    }
    // Deactivate rather than hard-delete (preserves task/notification history)
    const user = await User.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== EMAIL INVITE (SSO — no passwords) ====================
app.post('/api/team/invite', requireAdmin, async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const role = ['Admin', 'Team Owner', 'Member'].includes(req.body.role) ? req.body.role : 'Member';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'A valid email is required' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'User already exists' });

    const name = email.split('@')[0];
    const user = new User({
      name,
      email,
      role,
      profilePictureUrl: `https://i.pravatar.cc/150?u=${encodeURIComponent(email)}`,
    });
    await user.save();

    let emailSent = false;
    if (process.env.SMTP_USER) {
      try {
        await transporter.sendMail({
          from: `"Mayvel Task" <${process.env.SMTP_USER}>`,
          to: email,
          subject: `${req.user.name} invited you to Mayvel Task`,
          html: `
            <div style="font-family: 'Inter', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #6c5ce7;">You're invited to Mayvel Task!</h2>
              <p>${req.user.name} has invited you to join the workspace as <strong>${role}</strong>.</p>
              <p>Sign in with your Microsoft work account — no password needed.</p>
              <a href="${APP_URL}" style="display: inline-block; background: #6c5ce7; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open Mayvel Task</a>
            </div>
          `,
        });
        emailSent = true;
      } catch (emailErr) {
        console.log('Email send failed:', emailErr.message);
      }
    }

    res.status(201).json({
      user,
      emailSent,
      message: emailSent
        ? `Invitation sent to ${email}. They sign in with their Microsoft account.`
        : `User added. Tell them to sign in with their Microsoft account (${email}).`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PROFILE PICTURE UPLOAD ====================
app.post('/api/users/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
  try {
    const isSelf = req.params.id === req.user._id.toString();
    if (!isSelf && req.user.role !== 'Admin') {
      return res.status(403).json({ message: 'You can only change your own avatar' });
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded (images only: jpg, png, webp, gif; max 5MB)' });

    const ext = ALLOWED_IMAGE_TYPES[req.file.mimetype];
    const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    await fileStore.putFile(`avatars/${filename}`, req.file.buffer, req.file.mimetype);
    const avatarUrl = `${SERVER_URL}/files/avatars/${filename}`;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { profilePictureUrl: avatarUrl },
      { new: true }
    );

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ profilePictureUrl: avatarUrl, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user profile — self can edit name/avatar; only Admin can edit email/role/active
app.put('/api/users/:id', async (req, res) => {
  try {
    const isSelf = req.params.id === req.user._id.toString();
    const isAdmin = req.user.role === 'Admin';
    if (!isSelf && !isAdmin) return res.status(403).json({ message: 'Not allowed' });

    const updates = pick(req.body, ['name', 'profilePictureUrl']);
    if (isAdmin) Object.assign(updates, pick(req.body, ['email', 'role', 'active']));
    if (updates.role && !['Admin', 'Team Owner', 'Member'].includes(updates.role)) delete updates.role;
    if (isSelf && isAdmin && updates.role && updates.role !== 'Admin') {
      return res.status(400).json({ message: 'You cannot demote yourself' });
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PROJECT ROUTES ====================
const PROJECT_FIELDS = ['name', 'description', 'color', 'icon', 'teamspaceId'];

app.get('/api/projects', async (req, res) => {
  try {
    const filter = {};
    const tsId = str(req.query.teamspaceId);
    if (tsId) {
      filter.$or = [
        { teamspaceId: tsId },
        { teamspaceId: { $exists: false } },
        { teamspaceId: null }
      ];
    }
    const projects = await Project.find(filter).sort({ createdDate: -1 });
    // Single aggregation for counts (was N+1)
    const counts = await Task.aggregate([
      { $match: { projectId: { $in: projects.map(p => p._id.toString()) } } },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map(c => [c._id, c.count]));
    res.json(projects.map(p => ({ ...p.toObject(), taskCount: countMap[p._id.toString()] || 0 })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const project = new Project({ ...pick(req.body, PROJECT_FIELDS), createdBy: req.user.name });
    await project.save();
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, pick(req.body, PROJECT_FIELDS), { new: true, runValidators: true });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', requireAdmin, async (req, res) => {
  try {
    await Project.findByIdAndDelete(req.params.id);
    await Task.updateMany({ projectId: req.params.id }, { $unset: { projectId: '' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TASK ROUTES ====================
const TASK_FIELDS = [
  'id', 'title', 'description', 'status', 'priority', 'assignee', 'dueDate', 'startDate',
  'projectId', 'sprintId', 'pageId', 'parentId', 'estimatedHours', 'actualHours',
  'taskType', 'customProperties', 'attachments', 'teamspaceId',
];
const MAX_TASK_LIMIT = 5000;

app.get('/api/tasks', async (req, res) => {
  try {
    const { status, assignee, projectId, pageId, priority, sprintId, teamspaceId, search, limit, skip } = req.query;
    const filter = {};
    if (str(status))    filter.status = status;
    if (str(assignee))  filter.assignee = { $regex: escapeRegex(assignee), $options: 'i' };
    if (str(projectId)) filter.projectId = projectId;
    if (str(pageId))    filter.pageId = pageId;
    if (str(priority))  filter.priority = priority;
    if (str(sprintId))  filter.sprintId = sprintId;
    if (str(teamspaceId)) {
      filter.$or = [
        { teamspaceId: teamspaceId },
        { teamspaceId: { $exists: false } },
        { teamspaceId: null }
      ];
    }
    if (str(search))    filter.title = { $regex: escapeRegex(search), $options: 'i' };

    const lim = Math.min(parseInt(limit) || MAX_TASK_LIMIT, MAX_TASK_LIMIT);
    const query = Task.find(filter).sort({ createdDate: -1 }).limit(lim);
    if (str(skip)) query.skip(parseInt(skip) || 0);

    const tasks = await query;
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const data = pick(req.body, TASK_FIELDS);
    if (!data.id) data.id = `task_${crypto.randomUUID()}`;
    const task = new Task({ ...data, updatedBy: req.user.name });
    await task.save();
    // Fire workflow trigger (no broadcast notification for create)
    workflowEngine.fire('task_created', task.toObject());
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const updates = { ...pick(req.body, TASK_FIELDS.filter(f => f !== 'id')), updatedBy: req.user.name };
    const actorName = req.user.name;

    const oldTask = await Task.findOne({ id: req.params.id });
    if (!oldTask) return res.status(404).json({ message: 'Task not found' });

    // A Member cannot approve their own task that is in review
    if (updates.status === 'Completed' && oldTask.status === 'In Review'
        && req.user.role === 'Member' && oldTask.assignee === req.user.name) {
      return res.status(403).json({ message: 'Only an Admin or Team Owner can approve a task in review' });
    }

    const task = await Task.findOneAndUpdate({ id: req.params.id }, updates, { new: true, runValidators: true });
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (oldTask) {
      // Status changed
      if (updates.status && oldTask.status !== updates.status) {
        const ctx = { fromStatus: oldTask.status, toStatus: updates.status };

        // Task submitted for review → notify all Admins
        if (updates.status === 'In Review') {
          const admins = await User.find({ role: 'Admin', active: { $ne: false } }, 'name');
          for (const admin of admins) {
            createNotification({
              type: 'review_requested',
              title: 'Review Requested',
              message: `"${task.title}" submitted for review by ${task.assignee || 'a team member'}`,
              taskId: task.id,
              taskTitle: task.title,
              userId: admin.name,
              actorName: task.assignee || actorName,
            });
          }
        }

        // Task approved → notify the assignee
        if (updates.status === 'Completed' && oldTask.status === 'In Review') {
          if (task.assignee) {
            createNotification({
              type: 'task_completed',
              title: 'Task Approved ✅',
              message: `"${task.title}" has been approved by ${actorName}`,
              taskId: task.id,
              taskTitle: task.title,
              userId: task.assignee,
              actorName,
            });
          }
        }

        // Task rejected → notify the assignee
        if (updates.status === 'Rejected') {
          if (task.assignee) {
            createNotification({
              type: 'task_rejected',
              title: 'Task Rejected ❌',
              message: `"${task.title}" was rejected by ${actorName}. Please rework.`,
              taskId: task.id,
              taskTitle: task.title,
              userId: task.assignee,
              actorName,
            });
          }
        }

        workflowEngine.fire('status_changed', task.toObject(), ctx);
      }

      // Assignee changed → notify the new assignee
      if (updates.assignee && oldTask.assignee !== updates.assignee) {
        createNotification({
          type: 'task_assigned',
          title: 'Task Assigned',
          message: `"${task.title}" has been assigned to you by ${actorName}`,
          taskId: task.id,
          taskTitle: task.title,
          userId: updates.assignee,
          actorName,
        });
        workflowEngine.fire('assignee_changed', task.toObject(), { oldAssignee: oldTask.assignee, newAssignee: updates.assignee });
      }

      if (updates.projectId && oldTask.projectId !== updates.projectId) {
        workflowEngine.fire('task_moved_to_project', task.toObject());
      }
      workflowEngine.fire('task_updated', task.toObject());
    }

    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await Task.findOneAndDelete({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload files to a task. Stored under random keys in the file store; the
// path saved on the task is our authenticated download route (below), so
// attachments are only reachable by signed-in users.
app.post('/api/tasks/:id/attachments', attachmentUpload.array('attachments', 10), async (req, res) => {
  try {
    const task = await Task.findOne({ id: req.params.id });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        message: 'No valid files uploaded (allowed: pdf, office docs, csv, txt, md, zip, images, mp4/mov, json; max 10MB each)',
      });
    }
    const added = [];
    for (const f of req.files) {
      const ext = path.extname(f.originalname || '').toLowerCase();
      const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
      await fileStore.putFile(`attachments/${filename}`, f.buffer, f.mimetype);
      added.push({
        id: crypto.randomUUID(),
        name: f.originalname,
        path: `/api/files/attachments/${filename}`,
        sizeBytes: f.size,
        addedAt: new Date(),
      });
    }
    task.attachments.push(...added);
    task.updatedBy = req.user.name;
    await task.save();
    res.status(201).json({ attachments: task.attachments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Authenticated attachment download — streams from the file store.
app.get('/api/files/attachments/:key', async (req, res) => {
  try {
    if (!/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/.test(req.params.key)) return res.status(400).end();
    const f = await fileStore.getFile(`attachments/${req.params.key}`);
    if (!f) return res.status(404).json({ message: 'File not found' });
    if (f.contentType) res.setHeader('Content-Type', f.contentType);
    if (f.contentLength) res.setHeader('Content-Length', f.contentLength);
    res.setHeader('Content-Disposition', 'attachment');
    f.body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== NOTIFICATION ROUTES ====================
// Notifications are always scoped to the authenticated user (no ?user= spoofing).
app.get('/api/notifications', async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.name })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notifications/unread-count', async (req, res) => {
  try {
    const count = await Notification.countDocuments({ read: false, userId: req.user.name });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user.name }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/mark-all-read', async (req, res) => {
  try {
    await Notification.updateMany({ read: false, userId: req.user.name }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user.name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PROPERTY DEFINITIONS ====================
app.get('/api/properties', async (req, res) => {
  try {
    const props = await PropertyDefinition.find();
    res.json(props);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/properties', async (req, res) => {
  try {
    const prop = new PropertyDefinition(pick(req.body, ['id', 'name', 'type', 'options']));
    await prop.save();
    res.status(201).json(prop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== WORKFLOW ROUTES (writes are Admin-only) ====================
const WORKFLOW_FIELDS = ['name', 'description', 'icon', 'color', 'enabled', 'trigger', 'conditions', 'actions'];

app.get('/api/workflows', async (req, res) => {
  try {
    const workflows = await Workflow.find().sort({ createdDate: -1 });
    res.json(workflows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflows', requireAdmin, async (req, res) => {
  try {
    const workflow = new Workflow({ ...pick(req.body, WORKFLOW_FIELDS), createdBy: req.user.name });
    await workflow.save();
    res.status(201).json(workflow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/workflows/:id', requireAdmin, async (req, res) => {
  try {
    const workflow = await Workflow.findByIdAndUpdate(req.params.id, pick(req.body, WORKFLOW_FIELDS), { new: true, runValidators: true });
    if (!workflow) return res.status(404).json({ message: 'Workflow not found' });
    res.json(workflow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workflows/:id', requireAdmin, async (req, res) => {
  try {
    await Workflow.findByIdAndDelete(req.params.id);
    await WorkflowLog.deleteMany({ workflowId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflows/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const wf = await Workflow.findById(req.params.id);
    if (!wf) return res.status(404).json({ message: 'Workflow not found' });
    wf.enabled = !wf.enabled;
    await wf.save();
    res.json(wf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workflows/:id/logs', async (req, res) => {
  try {
    const logs = await WorkflowLog.find({ workflowId: req.params.id })
      .sort({ executedAt: -1 })
      .limit(50);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workflow-logs', async (req, res) => {
  try {
    const logs = await WorkflowLog.find().sort({ executedAt: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflows/:id/run', requireAdmin, async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) return res.status(404).json({ message: 'Workflow not found' });
    const task = await Task.findOne({ id: str(req.body.taskId) });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    await workflowEngine.fire(workflow.trigger.type, task.toObject());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SPRINT ROUTES ====================
const SPRINT_FIELDS = ['name', 'goal', 'projectId', 'status', 'startDate', 'endDate', 'teamspaceId'];

// GET all sprints (optionally filter by projectId)
app.get('/api/sprints', async (req, res) => {
  try {
    const filter = {};
    if (str(req.query.projectId)) filter.projectId = req.query.projectId;
    if (str(req.query.teamspaceId)) {
      filter.$or = [
        { teamspaceId: req.query.teamspaceId },
        { teamspaceId: { $exists: false } },
        { teamspaceId: null }
      ];
    }
    const sprints = await Sprint.find(filter).sort({ startDate: -1 });
    // Single aggregation for counts/points (was N+1)
    const sprintIds = sprints.map(s => s._id.toString());
    const agg = await Task.aggregate([
      { $match: { sprintId: { $in: sprintIds } } },
      { $group: {
          _id: '$sprintId',
          taskCount: { $sum: 1 },
          doneCount: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
          totalPoints: { $sum: { $ifNull: ['$estimatedHours', 0] } },
      } },
    ]);
    const aggMap = Object.fromEntries(agg.map(a => [a._id, a]));
    res.json(sprints.map(s => {
      const a = aggMap[s._id.toString()] || {};
      return { ...s.toObject(), taskCount: a.taskCount || 0, doneCount: a.doneCount || 0, totalPoints: a.totalPoints || 0 };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single sprint + its tasks
app.get('/api/sprints/:id', async (req, res) => {
  try {
    const sprint = await Sprint.findById(req.params.id);
    if (!sprint) return res.status(404).json({ message: 'Sprint not found' });
    const tasks = await Task.find({ sprintId: req.params.id }).sort({ createdDate: -1 });
    res.json({ ...sprint.toObject(), tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NOTION SYNC (Admin-only; token comes from server env, never from the browser)
app.post('/api/sprints/notion/sync', requireAdmin, async (req, res) => {
  try {
    const token = process.env.NOTION_TOKEN || str(req.body.token);
    const databaseId = str(req.body.databaseId);
    const teamspaceId = str(req.body.teamspaceId);
    if (!token || !databaseId) return res.status(400).json({ error: 'Notion token (server env) and Database ID are required' });

    const { Client } = require('@notionhq/client');
    const notion = new Client({ auth: token });
    const response = await notion.databases.query({ database_id: databaseId });

    const sprintsToInsert = [];
    for (const page of response.results) {
      const nameProp = Object.values(page.properties).find(p => p.type === 'title');
      const name = nameProp && nameProp.title[0] ? nameProp.title[0].plain_text : 'Untitled Sprint';

      const statusProp = Object.values(page.properties).find(p => p.type === 'select' || p.type === 'status');
      const statusStr = statusProp?.select?.name || statusProp?.status?.name || 'planned';
      const status = statusStr.toLowerCase() === 'active' || statusStr.toLowerCase() === 'in progress' ? 'active'
                   : statusStr.toLowerCase() === 'completed' || statusStr.toLowerCase() === 'done' ? 'completed' : 'planned';

      const dateProp = Object.values(page.properties).find(p => p.type === 'date');
      const startDate = dateProp?.date?.start || new Date();
      const endDate = dateProp?.date?.end || null;

      sprintsToInsert.push({
        name,
        status,
        startDate,
        endDate,
        goal: 'Imported from Notion',
        teamspaceId: teamspaceId || undefined
      });
    }

    if (sprintsToInsert.length > 0) {
      await Sprint.insertMany(sprintsToInsert);
    }

    res.json({ message: `Successfully imported ${sprintsToInsert.length} sprints from Notion`, count: sprintsToInsert.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE sprint
app.post('/api/sprints', async (req, res) => {
  try {
    const sprint = new Sprint({ ...pick(req.body, SPRINT_FIELDS), createdBy: req.user.name });
    await sprint.save();
    res.status(201).json(sprint);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE sprint metadata
app.put('/api/sprints/:id', async (req, res) => {
  try {
    const sprint = await Sprint.findByIdAndUpdate(req.params.id, pick(req.body, SPRINT_FIELDS), { new: true, runValidators: true });
    if (!sprint) return res.status(404).json({ message: 'Sprint not found' });
    res.json(sprint);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE sprint (tasks become unassigned)
app.delete('/api/sprints/:id', requireAdmin, async (req, res) => {
  try {
    await Sprint.findByIdAndDelete(req.params.id);
    await Task.updateMany({ sprintId: req.params.id }, { $unset: { sprintId: '' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// START sprint (set status = active, only one active at a time per project)
app.post('/api/sprints/:id/start', async (req, res) => {
  try {
    const sprint = await Sprint.findById(req.params.id);
    if (!sprint) return res.status(404).json({ message: 'Sprint not found' });
    // Deactivate any other active sprint in this project
    if (sprint.projectId) {
      await Sprint.updateMany({ projectId: sprint.projectId, status: 'active' }, { status: 'completed', completedAt: new Date() });
    }
    sprint.status = 'active';
    if (!sprint.startDate) sprint.startDate = new Date();
    await sprint.save();
    res.json(sprint);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// COMPLETE sprint — roll unfinished tasks to a target sprint
app.post('/api/sprints/:id/complete', async (req, res) => {
  try {
    const sprint = await Sprint.findById(req.params.id);
    if (!sprint) return res.status(404).json({ message: 'Sprint not found' });

    const rolloverSprintId = str(req.body.rolloverSprintId); // optional target sprint for unfinished tasks

    if (rolloverSprintId) {
      // Move incomplete tasks to the next sprint
      await Task.updateMany(
        { sprintId: req.params.id, status: { $nin: ['Completed', 'Rejected'] } },
        { sprintId: rolloverSprintId }
      );
    } else {
      // Unassign unfinished tasks from sprint
      await Task.updateMany(
        { sprintId: req.params.id, status: { $nin: ['Completed', 'Rejected'] } },
        { $unset: { sprintId: '' } }
      );
    }

    sprint.status = 'completed';
    sprint.completedAt = new Date();
    await sprint.save();
    res.json(sprint);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD task to sprint
app.post('/api/sprints/:id/tasks', async (req, res) => {
  try {
    const taskId = str(req.body.taskId);
    const task = await Task.findOneAndUpdate({ id: taskId }, { sprintId: req.params.id }, { new: true });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REMOVE task from sprint
app.delete('/api/sprints/:id/tasks/:taskId', async (req, res) => {
  try {
    await Task.findOneAndUpdate({ id: req.params.taskId }, { $unset: { sprintId: '' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PAGE ROUTES ====================
const PAGE_FIELDS = ['title', 'icon', 'content', 'hasDatabase'];

app.get('/api/pages', async (req, res) => {
  try {
    const pages = await Page.find().sort({ updatedDate: -1 });
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pages/:id', async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);
    if (!page) return res.status(404).json({ message: 'Page not found' });
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pages', async (req, res) => {
  try {
    const page = new Page({ ...pick(req.body, PAGE_FIELDS), createdBy: req.user.name });
    await page.save();
    res.status(201).json(page);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pages/:id', async (req, res) => {
  try {
    const page = await Page.findByIdAndUpdate(req.params.id, { ...pick(req.body, PAGE_FIELDS), updatedDate: new Date() }, { new: true, runValidators: true });
    if (!page) return res.status(404).json({ message: 'Page not found' });
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deleting a page cascades to its tasks — restricted to Admin or the page creator
app.delete('/api/pages/:id', async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);
    if (!page) return res.status(404).json({ message: 'Page not found' });
    if (req.user.role !== 'Admin' && page.createdBy !== req.user.name) {
      return res.status(403).json({ message: 'Only an Admin or the page creator can delete this page' });
    }
    await Page.findByIdAndDelete(req.params.id);
    // Delete all tasks associated with this page
    await Task.deleteMany({ pageId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ORG CHART ROUTES ====================

// GET org chart (optionally filter by teamspaceId)
app.get('/api/orgchart', async (req, res) => {
  try {
    const filter = {};
    if (str(req.query.teamspaceId)) {
      filter.teamspaceId = req.query.teamspaceId;
    } else {
      filter.teamspaceId = null;
    }
    const chart = await OrgChart.findOne(filter);
    if (!chart) return res.json({ nodes: [], edges: [] });
    res.json(chart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT (upsert) org chart — Admin-only: this drives approval hierarchies
app.put('/api/orgchart', requireAdmin, async (req, res) => {
  try {
    const { nodes, edges, teamspaceId } = req.body;
    const filter = { teamspaceId: str(teamspaceId) || null };
    const chart = await OrgChart.findOneAndUpdate(
      filter,
      { nodes, edges, updatedBy: req.user.name, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(chart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET hierarchy info for a specific member
// Returns: the node, its parent chain (managers), and direct reports
app.get('/api/orgchart/hierarchy/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const tsId = str(req.query.teamspaceId) || null;
    const filter = tsId ? { teamspaceId: tsId } : { teamspaceId: null };
    const chart = await OrgChart.findOne(filter);
    if (!chart) return res.json({ node: null, managers: [], directReports: [] });

    // Find the node for this member
    const node = chart.nodes.find(n => n.memberId === memberId);
    if (!node) return res.json({ node: null, managers: [], directReports: [] });

    // Build adjacency
    const parentMap = {};
    const childMap = {};
    chart.edges.forEach(e => {
      parentMap[e.to] = e.from;
      if (!childMap[e.from]) childMap[e.from] = [];
      childMap[e.from].push(e.to);
    });

    // Walk up to find all managers
    const managers = [];
    let current = node.id;
    while (parentMap[current]) {
      const parentNode = chart.nodes.find(n => n.id === parentMap[current]);
      if (parentNode) managers.push({ id: parentNode.id, name: parentNode.name, orgRole: parentNode.orgRole, memberId: parentNode.memberId });
      current = parentMap[current];
    }

    // Direct reports
    const directReportIds = childMap[node.id] || [];
    const directReports = directReportIds
      .map(rid => chart.nodes.find(n => n.id === rid))
      .filter(Boolean)
      .map(n => ({ id: n.id, name: n.name, orgRole: n.orgRole, memberId: n.memberId }));

    // All subordinates (recursive)
    const allSubordinates = [];
    const queue = [...directReportIds];
    while (queue.length) {
      const cid = queue.shift();
      const cNode = chart.nodes.find(n => n.id === cid);
      if (cNode) allSubordinates.push({ id: cNode.id, name: cNode.name, orgRole: cNode.orgRole, memberId: cNode.memberId });
      (childMap[cid] || []).forEach(sub => queue.push(sub));
    }

    res.json({
      node: { id: node.id, name: node.name, orgRole: node.orgRole, department: node.department, memberId: node.memberId },
      managers,
      directReports,
      allSubordinates,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PRODUCTION: SERVE FRONTEND ====================
// In production the built SPA (frontend/dist) is served by this same process,
// so erp.mayvel.ai is one service: / -> app, /api -> API, /uploads -> files.
const distDir = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { maxAge: '1h', index: 'index.html' }));
  // SPA fallback for anything that isn't API/uploads/health
  app.get(/^(?!\/api\/|\/uploads\/|\/healthz).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log('Serving frontend from', distDir);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`SSO configured: ${microsoftAuth.isConfigured() ? 'yes' : 'NO — set AZURE_TENANT_ID / AZURE_CLIENT_ID in .env'}`);
  console.log(`File storage: ${fileStore.describeBackend()}`);

  // Schedule due-date-approaching checks every hour
  setInterval(() => {
    workflowEngine.runScheduledChecks();
  }, 60 * 60 * 1000);
  setTimeout(() => workflowEngine.runScheduledChecks(), 5000);
});
