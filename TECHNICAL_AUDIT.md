# Mayvel Workspace — Technical Audit & Go-Live Readiness Plan

**Author:** Lead Tech Review
**Date:** 2026-07-30
**Scope:** `backend/` (Express + MongoDB), `frontend/` (React + Vite), import tooling, data model
**Context:** Preparing to go live for the Mayvel organization as a Notion-style task platform **plus** timesheet/ERP (weekly timesheets, project & budget approvals, org/team management, dashboards).

---

## 0. Executive Summary

> **REMEDIATION UPDATE (2026-07-30):** All P0 security blockers in §2 have been fixed — the API is now
> Microsoft-SSO-only (Entra ID) with JWT sessions, server-side RBAC, mass-assignment allow-lists,
> helmet/CORS/rate-limiting, hardened uploads, env-based secrets, fixed `.gitignore`, and a
> non-destructive Notion sync. See `SSO_SETUP.md` for the one-time Azure app registration.
> Still outstanding: **rotate the Notion token + Atlas password** (they were exposed in source),
> and the P1/P2 items in §3–§5 (assignee→userId migration, teamspace isolation, timesheet/budget ERP features).

**Verdict at time of audit: 🔴 NOT production-ready. Do not go live in the current state.**

The product is a solid **MVP/prototype**: the task/sprint/workflow/teamspace feature set works, the UI is complete, and the Notion import pipeline is functional (2,431 tasks / 25 projects imported). However:

1. **The API has zero authentication.** Every endpoint — including *delete user*, *delete teamspace*, *read all data* — is callable by anyone who can reach the server. Login exists only as a UI gate.
2. **Passwords are stored and transmitted in plaintext**, and are returned in API responses and persisted in browser `localStorage`.
3. **Authorization (RBAC) exists only in the frontend.** The server never checks who you are or what role you have.
4. **Secrets are hardcoded in source** (two live Notion API tokens), and the root `.gitignore` does **not** exclude `backend/.env` — one `git init && git push` away from leaking the Atlas connection string.
5. **None of the ERP features you're going live for exist yet**: no timesheet model, no weekly submission/approval flow, no budget fields or budget approval, no leave management, no employee master data beyond name/email/role.

**Estimated distance to a safe internal go-live: ~4–6 engineering weeks** (Phase 0 + Phase 1 below). The ERP scope (timesheets, budgets, approvals) is a further **6–8 weeks** (Phase 2–3).

Severity legend: 🔴 **P0 — go-live blocker** · 🟠 **P1 — fix within first sprint after launch** · 🟡 **P2 — important, schedule it** · ⚪ **P3 — nice to have**

---

## 1. Current Architecture (as-built)

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│  React 19 + Vite SPA     │  HTTP  │  Express 5 (server.js, ~950   │
│  state-based "routing"   ├───────►│  lines, single file)          │
│  Context API state       │        │  no auth / no validation      │
│  localStorage session    │        │  Mongoose 9 ODM               │
└──────────────────────────┘        └──────────────┬────────────────┘
                                                   │
                              ┌────────────────────┼──────────────────┐
                              ▼                    ▼                  ▼
                       MongoDB Atlas        Local disk uploads   Nodemailer SMTP
                       (9 collections)      (backend/uploads)    (invite emails)
```

- **Models:** `User`, `Task`, `Project`, `Sprint`, `Teamspace`, `Page`, `Workflow`+`WorkflowLog`, `Notification`, `OrgChart`
- **Workflow engine:** in-process trigger/condition/action evaluator + hourly `setInterval` for due-date checks
- **Notion import:** one-shot scripts (`backend/scripts/importNotion.js`, `fixProjects.js`) using the data-source API
- **Repo oddity:** the repository root is a **Flutter skeleton** (`pubspec.yaml`, `android/`, `ios/`, `lib/`…) with the real product living in `backend/` + `frontend/`, plus an unrelated `notion-workspace/` Next.js app. It is **not a git repository**.

---

## 2. 🔴 Critical Security Findings (P0 — every one blocks go-live)

### 2.1 No authentication on any API endpoint
`backend/server.js` registers ~55 routes; **none** have an auth middleware. There is no JWT, no session, no API key. `POST /api/auth/login` merely returns the user document — nothing about subsequent requests proves identity.

**Impact:** anyone on the network (or the internet, once deployed) can run:
```
curl -X DELETE http://<host>:3000/api/team/<anyUserId>      # delete any employee
curl -X DELETE http://<host>:3000/api/teamspaces/<id>        # delete a teamspace
curl http://<host>:3000/api/tasks                            # read all 2,431 tasks
curl -X PUT http://<host>:3000/api/users/<id> -d '{"role":"Admin"}'  # self-promote
```
**Fix:** JWT (access + refresh) or server-side sessions; a `requireAuth` middleware applied to every `/api/*` route except login; `requireRole('Admin')` on destructive/administrative routes.

### 2.2 Plaintext passwords — stored, compared, returned, and cached
- `backend/models/User.js:6` — `password: { type: String, required: true } // Simple plain text for mock purposes`
- `backend/server.js:87` — `user.password !== password` (plaintext comparison)
- `backend/server.js:77` and `:90` — signup/login `res.json(user)` return the document **including the password field**
- `frontend/src/context/AuthContext.jsx:13` — the full user object (password included) is written to `localStorage`
- `backend/server.js:207-214` — the invite endpoint returns `tempPassword` in the JSON response and emails it in plaintext

**Fix:** bcrypt/argon2 hashing; `select: false` on the password field; never serialize it; a real invite-link flow (signed, expiring token) instead of emailing passwords; forced password change on first login.

### 2.3 RBAC is client-side only
All role checks live in JSX (`frontend/src/pages/TeamPage.jsx:11`, `TasksPage.jsx:136`, `TaskDetailPage.jsx:76`, etc.). The server enforces nothing. A "Member" can approve their own "In Review" task, delete other users, edit anyone's profile, or toggle workflows — just not through the UI.

Additional inconsistency: the UI checks for role `'Team Owner'`, but `User.role` enum is only `['Admin','Member']` (`models/User.js:7`) — "Team Owner" can never exist in the DB, so those code paths are dead.

**Fix:** role checks in middleware, driven by the authenticated principal — never by `req.body.updatedBy` (currently the server trusts the client to say who performed an action, e.g. `server.js:377`).

### 2.4 Anyone can self-register as Admin
`POST /api/auth/signup` (`server.js:69-81`) accepts `role` straight from the request body. First thing an attacker does: `{"role":"Admin"}`.

**Fix:** ignore `role` on signup (default Member); admin promotion only via an authenticated Admin route; consider disabling open signup entirely for an internal tool (invite-only).

### 2.5 Mass assignment everywhere
`findByIdAndUpdate(req.params.id, req.body)` is the pattern for users (`server.js:242`), teamspaces (`:126`), projects (`:284`), tasks (`:347`), sprints (`:701`), workflows (`:538`), pages (`:824`). Any caller can set **any** schema field — `role`, `password`, `teamspaceId`, `executionCount`…

**Fix:** explicit field allow-lists per route (or a validation layer — zod/joi/celebrate) before any write.

### 2.6 Live secrets committed in source; `.env` not gitignored
- `backend/scripts/importNotion.js:5` and `fixProjects.js:5` — hardcoded Notion token `ntn_277...`
- `backend/import-notion.js:10` — a **second** hardcoded Notion token
- Root `.gitignore` is Flutter's template: it ignores neither `backend/.env` (which holds the **Atlas URI with credentials**) nor `node_modules/`

**Fix:** move tokens to `.env`; add `.env*`, `node_modules/`, `uploads/` to `.gitignore` **before** the first commit; rotate both Notion tokens and the Atlas password (treat them as compromised — they've been in plaintext on disk and in chat/editor history).

### 2.7 Unauthenticated file upload → stored XSS / disk abuse
`POST /api/users/:id/avatar` (`server.js:221`): no auth, no MIME/extension allow-list, and files are served statically from the same origin (`server.js:27`). Upload `evil.html` and you have a same-origin phishing/XSS page at `/uploads/...`. `filename: Date.now()-originalname` also trusts the client's filename.

**Fix:** auth required; extension + MIME allow-list (jpg/png/webp); randomize filenames (never use `originalname`); serve uploads with `Content-Disposition` or from a separate static origin/bucket; per-user quota.

### 2.8 Injection surface
- **NoSQL injection:** `User.findOne({ email })` with unvalidated JSON body — `{"email": {"$gt": ""}}` enumerates users. Same pattern on invite.
- **ReDoS / regex injection:** `filter.assignee = { $regex: assignee }` and `filter.title = { $regex: search }` (`server.js:307,319`) build regexes from raw user input.
- **Email HTML injection:** the invite email template interpolates `inviterName` and `email` unescaped into HTML (`server.js:186-197`).

**Fix:** validate types (strings only) at the boundary; escape regex metacharacters (`escape-string-regexp`); use a text-search index for search; escape HTML in email templates.

### 2.9 Wide-open CORS + no hardening
`app.use(cors())` (`server.js:21`) reflects any origin. No `helmet`, no rate limiting (login is brute-forceable at line speed), no request size limits beyond defaults, no HTTPS story.

**Fix:** CORS allow-list; `helmet`; `express-rate-limit` on auth routes; deploy behind TLS (reverse proxy).

### 2.10 Notification/IDOR issues
Notifications are keyed by **user display name**, not id (`models/Notification.js`, `server.js:441-449`), and fetched via `?user=<name>` with no auth. Anyone can read, mark-read, or delete anyone's notifications; two employees named "Karthick" collide.

---

## 3. 🟠 Data-Model & Correctness Issues (P1)

| # | Issue | Where | Consequence |
|---|-------|-------|-------------|
| 3.1 | **`assignee` is a free-text name string**, not a `User` ref | `Task.assignee`, notifications, workflow engine | Rename an employee → all their assignments, notifications, and "my tasks" filters silently break. Duplicate names collide. This single decision undermines the whole ERP plan — fix before building timesheets on top. |
| 3.2 | **Teamspace "isolation" leaks** | `server.js:312-318` (and projects/sprints): filter matches `teamspaceId ∈ {X, missing, null}` | Every teamspace sees all legacy/unassigned data — including all 2,431 imported tasks. This is a *default-visible* model, the opposite of tenant isolation. |
| 3.3 | **App-level IDs from `Date.now()`** | `workflowEngine.js` `task_auto_${Date.now()}`, `task_dup_${Date.now()}` | Two actions in the same millisecond → duplicate-key crash. Use UUIDs. |
| 3.4 | **Imported tasks aren't linked to sprints** | Import sets `notionSprintId` but no mapping to local `Sprint` docs exists (unlike projects via `fixProjects.js`) | Sprint views show none of the imported history. |
| 3.5 | **Duplicate, divergent Task schemas** | `scripts/importNotion.js:13-35` re-declares its own `taskSchema` vs `models/Task.js` | Schema drift; import bypasses app defaults/validation. Scripts should import the real model. |
| 3.6 | **Destructive import** | `scripts/importNotion.js:99` `Task.deleteMany({})` | Re-running the importer wipes every task created inside Mayvel itself. Must become an upsert-by-`notionId` sync. |
| 3.7 | **No cascade strategy** | Delete user → tasks/notifications/orgchart keep dangling name refs; delete teamspace → projects/tasks/sprints orphaned (only page-delete cascades, `server.js:832-841`) | Data rot; "ghost" records in reports. Define per-entity: cascade, unlink, or forbid-if-referenced. |
| 3.8 | **Workflow engine re-entrancy & dedup** | `fire('task_updated')` on every PUT; hourly `due_date_approaching` re-fires per task **every hour** with no "already fired" marker (`workflowEngine.js:runScheduledChecks`) | Notification spam (same reminder 24×/day); workflow actions can chain unexpectedly; actions mutate tasks without firing the notifications the manual path fires. |
| 3.9 | **Race conditions** | Sprint start "deactivate others then activate" is two non-atomic writes (`server.js:721-736`); no optimistic locking on task edits | Two admins → two active sprints; concurrent edits silently overwrite each other (last-write-wins with full-body PUTs). |
| 3.10 | **No pagination defaults** | `GET /api/tasks` returns everything unless the client passes `limit` — and the frontend never does (`frontend/src/api.js:10`) | Every page load ships all 2,431 tasks (and grows). Dashboard filtering is all client-side. |
| 3.11 | **N+1 queries** | Projects: one `countDocuments` per project (`server.js:262-265`); sprints: 3 queries + 1 aggregate per sprint (`:616-624`) | 25 projects → 26 queries per request. Replace with a single `$group` aggregation. |
| 3.12 | **No indexes** | Only implicit uniques (`User.email`, `Task.id`) | Every task filter (`status`, `assignee`, `projectId`, `sprintId`, `teamspaceId`, `createdDate` sort) is a collection scan. |
| 3.13 | **Hardcoded URLs** | `frontend/src/api.js:3` (`127.0.0.1:3000`), avatar URL `server.js:225`, invite link `server.js:197` (`localhost:5173`) | App cannot be deployed anywhere without a code edit. Use `import.meta.env.VITE_API_URL` / config. |
| 3.14 | **State-based navigation, no routes** | `App.jsx` switches pages via `useState`; `react-router-dom` is installed but unused; task links use a `window.dispatchEvent` hack | No deep links ("see task X" can't be a URL), no back button, no bookmarkable dashboards — painful for a team tool where people share links. |
| 3.15 | **Polling everywhere** | NotificationBell polls every 5s per open tab (`NotificationBell.jsx:26`) | With ~30 employees ≈ 6+ req/s of pure polling. Fine short-term; plan SSE/WebSocket. |
| 3.16 | **Hours as flat numbers** | `estimatedHours`/`actualHours` on Task | No per-day, per-person time entries — cannot produce a weekly timesheet from this. See §5. |

---

## 4. 🟡 Engineering & Operations Gaps (P1–P2)

- **Zero tests.** Backend: `"test": "echo \"Error: no test specified\""`. Frontend: none. Before ERP flows (money, payroll-adjacent data), you need at minimum: auth middleware tests, RBAC matrix tests, timesheet calculation tests.
- **No CI/CD, no environments.** No dev/staging/prod split, no Docker/compose, no build pipeline, no migrations framework (ad-hoc `migrate.js` scripts).
- **Single 950-line `server.js`.** Split into `routes/`, `controllers/`, `middleware/`, `services/`. The org-chart `require` mid-file (`server.js:842`) is a smell.
- **No structured logging / monitoring / error tracking.** `console.log` only; no request IDs; no health endpoint (`GET /` is a 404 — add `/healthz`); no uptime alerting; no Sentry.
- **No backups/DR plan.** Atlas has snapshots on paid tiers — verify tier, retention, and do one restore drill before go-live. `uploads/` on local disk is unbacked-up and lost on redeploy — move to S3/GCS or at least include in backup.
- **Email is best-effort** with Gmail SMTP defaults; invite succeeds even when the email fails (user is created; temp password only visible in the API response). Use a transactional provider (SES/Resend/Postmark) + delivery logging.
- **Process management:** the hourly scheduler lives inside the web process (`server.js:944-947`); with 2+ instances it double-fires. Run schedulers as a separate worker or use a locking job queue (Agenda/BullMQ).
- **Repo hygiene:** initialize git (it currently isn't a repo!), remove the Flutter skeleton or move `backend/`+`frontend/` to their own repo, decide the fate of `notion-workspace/`, write a real README (setup, env vars, run, deploy), fix `.gitignore` **first** (see 2.6).

---

## 5. Feature-Gap Analysis vs Your Go-Live Goals

You stated the target: *Notion-like task platform + weekly timesheet ERP + project & budget approval + org management + dashboards.* Here's the honest delta:

### 5.1 Notion parity — ~30% there
| Capability | Status |
|---|---|
| Tasks: board/list/table, filters, priorities, subtasks (`parentId`) | ✅ Exists |
| Sprints with lifecycle + rollover | ✅ Exists |
| Custom properties (definitions + values) | 🟡 Model exists (`PropertyDefinition`), thin UI |
| Pages | 🟡 Flat plain-text/markdown string only (`models/Page.js:6`) — no blocks, no nesting, no embeds |
| Rich-text block editor | ❌ Missing (consider TipTap/BlockNote/Plate rather than building one) |
| Nested page hierarchy / sidebar tree | ❌ Missing (no `parentPageId`) |
| Comments & @mentions on tasks/pages | ❌ Missing — this is the #1 collaboration feature teams expect |
| Full-text search across tasks/pages | ❌ Missing (only title regex) |
| Relations/rollups between databases | ❌ Missing |
| Real-time co-editing / presence | ❌ Missing (long-term; don't promise it) |
| Version history / trash-restore | ❌ Missing (hard deletes everywhere — add `deletedAt` soft delete) |
| Templates (task/page/project) | ❌ Missing |
| Continuous Notion **sync** (two-way or scheduled one-way) | ❌ One-shot destructive import only |

### 5.2 Timesheet / ERP — ~0% there (nothing exists)
Required net-new work:
- **`TimeEntry` model** — the atom of the ERP:
  ```js
  { userId, taskId?, projectId, date, hours, note,
    timesheetId, createdAt, updatedAt }
  ```
- **`Timesheet` model** — weekly container with a state machine:
  `Draft → Submitted → Approved | Rejected(reason) → Resubmitted`, fields: `userId, weekStart, entries[], status, submittedAt, approverId, decidedAt, totalHours, overtimeHours`.
- **Approval routing from the org chart** — you already have `GET /api/orgchart/hierarchy/:memberId` returning managers (`server.js:881-937`); the approver should default to the employee's direct manager. This is the one place the current codebase gives you a head start — but it depends on fixing 3.1 (name-string identity).
- **Timesheet UX:** weekly grid (rows = tasks/projects, columns = Mon–Sun), copy-last-week, submit button, approver inbox with bulk approve, locked weeks after approval.
- **Reminders:** Friday "submit your timesheet" + Monday "approve pending" notifications (extend the workflow engine or the scheduler worker).
- **Compliance:** approved timesheets must be **immutable** (or amendment-only with audit trail) — payroll may depend on them.

### 5.3 Project & budget approval — 0% there
- `Project` has no financial fields at all (`models/Project.js`). Add: `budgetAmount, currency, budgetStatus (Draft/PendingApproval/Approved/Rejected), approvedBy, approvedAt, costToDate`.
- **`ApprovalRequest` model** (generic — reuse for budgets, projects, timesheets, leave):
  `{ type, subjectId, requestedBy, approverChain[], currentStep, status, history[{actor, action, comment, at}] }`.
- Cost roll-up: your Notion data already has `Cost(Rs)`/`Discounted Cost(Rs)` formulas and `Flash Points` — the import currently **drops all of them**. Decide which financial fields to carry over.
- Budget vs. actuals on the dashboard (needs `TimeEntry × rate` or task-cost data).

### 5.4 Organization / HR — ~20% there
- OrgChart exists (visual, hierarchy queries) ✅ — but `User` is only `{name, email, password, role, avatar}`.
- Missing employee master data: designation, department, employment type, date of joining, manager (derive from org chart but store canonically), status (active/exited), work location.
- Missing: **leave management** — notably your own Notion workspace tracks leave as a project ("Leave", 53 tasks; "Casual leave" tasks) — model it properly: `LeaveRequest {userId, type, from, to, status, approverId}` reusing the ApprovalRequest flow.
- Missing: onboarding/offboarding checklists (could be task templates), deactivation instead of hard user delete (3.7).

### 5.5 Dashboards — ~35% there
- Current: personal/summary dashboard with client-side filtering over the full task dump (`DashboardPage.jsx`).
- Needed for ERP go-live: org-wide utilization (billable hours by person/week), project health (budget vs. actual, burn rate), timesheet compliance (who hasn't submitted), sprint velocity/burndown (PRD Phase 4), approval queue widget. All of these need **server-side aggregation endpoints** (`/api/reports/...`) — do not ship them as client-side filters over full collections.

---

## 6. Target Architecture (pragmatic, not over-engineered)

Keep the stack (Node/Express/Mongo/React) — it's fine for a company-internal tool at your scale. Change the shape:

```
frontend (React SPA, react-router, VITE_API_URL config)
   │  HTTPS (reverse proxy: Caddy/nginx, TLS, gzip)
   ▼
API service (Express)
 ├─ middleware: helmet, cors-allowlist, rate-limit, auth(JWT), rbac, zod-validate, request-id logging
 ├─ routes/: auth, users, teamspaces, projects, tasks, sprints, pages,
 │           workflows, notifications, orgchart, timesheets, approvals, reports
 ├─ services/: business logic (approval state machines, timesheet math)
 └─ jobs worker (separate process): scheduler, notion-sync, email queue, reminders
   ▼
MongoDB Atlas (indexes, migrations via migrate-mongo, PITR backups verified)
S3-compatible bucket for uploads
Sentry + structured logs (pino) + /healthz + uptime monitor
```

**Identity model change (the keystone):** every place that stores a person must store `userId: ObjectId` (Task.assignee, Notification.userId, OrgChart.memberId, createdBy/updatedBy fields). Names are display-only, resolved at read time. Do this migration **before** building timesheets.

---

## 7. Phased Roadmap

### Phase 0 — Stop-the-bleeding (before ANY deployment) — ~1 week
1. Rotate Notion tokens + Atlas password; move all secrets to `.env`; fix `.gitignore`; `git init` and commit clean.
2. JWT auth middleware on all routes; hash passwords (bcrypt) + migration for existing users; strip password from all responses and localStorage.
3. Server-side RBAC on destructive/admin routes; kill `role` in signup body; make invites invite-link-based.
4. Field allow-lists on all update routes; input validation (zod); regex escaping.
5. CORS allow-list, helmet, rate-limit on `/api/auth/*`; upload MIME/extension checks + random filenames.
6. Config: `VITE_API_URL`, server base URL for avatars/invite links.

### Phase 1 — Internal go-live hardening — ~2–3 weeks
7. Assignee → `userId` migration (3.1) — touches tasks, notifications, workflows, UI dropdowns.
8. Teamspace isolation (3.2): backfill `teamspaceId` on all imported data; remove `$exists:false` fallback; membership checks server-side.
9. Pagination + indexes + aggregation endpoints for counts (3.10–3.12).
10. React Router with real URLs (`/tasks/:id`, `/sprints/:id`) (3.14).
11. Soft deletes + cascade policy (3.7); user deactivation.
12. Notion **sync** job (upsert by `notionId`, scheduled, non-destructive; map sprints — 3.4/3.6).
13. Tests for auth/RBAC/core CRUD; GitHub Actions CI; Dockerfile + compose; staging env; Sentry; `/healthz`; backup restore drill.
14. **Pilot with one team for a week before company-wide rollout.**

### Phase 2 — Timesheet ERP core — ~3–4 weeks
15. `TimeEntry` + `Timesheet` models, weekly grid UI, submit flow.
16. `ApprovalRequest` engine (generic state machine + approver inbox UI), wired to the org chart for routing.
17. Timesheet approval + immutability + audit log (append-only `AuditEvent` collection for every approval/financial mutation).
18. Reminder jobs (submit/approve); timesheet compliance report.

### Phase 3 — Budgets, leave, dashboards — ~3–4 weeks
19. Project budget fields + budget ApprovalRequest flow; cost-to-date roll-ups.
20. Leave management (reuse approvals); import/replace the Notion "Leave" project.
21. Reporting endpoints + dashboard v2 (utilization, project health, velocity/burndown, approval queues).

### Phase 4 — Notion depth (ongoing)
22. Block-based editor (TipTap/BlockNote), nested pages, comments + @mentions (mentions feed notifications), full-text search (Atlas Search), templates, trash/restore, then relations/rollups.

---

## 8. Go-Live Checklist (gate for Phase 1 exit)

- [ ] No endpoint reachable without a valid token; RBAC matrix documented and tested
- [ ] Passwords hashed; no secret in source; tokens rotated; `.env` gitignored; repo history clean
- [ ] TLS in front of both apps; CORS locked to the app origin
- [ ] All imported data assigned to correct teamspace/owner; assignees are userIds
- [ ] p95 API latency < 300ms on tasks list with realistic data (pagination + indexes)
- [ ] Error tracking + uptime alerts live; `/healthz` monitored
- [ ] Backup restore actually performed once; uploads durable
- [ ] CI green: lint + tests on every push; one-command deploy to staging/prod
- [ ] Runbook: how to deploy, roll back, restore, rotate secrets, add a user
- [ ] One-team pilot completed; feedback triaged

---

## 9. Quick Wins (can do today, < 1 day total)

1. Add `.gitignore` entries (`backend/.env`, `**/node_modules`, `backend/uploads`) — before anything else.
2. Move the 3 hardcoded Notion tokens into `backend/.env` and rotate them.
3. `helmet` + `express-rate-limit` + CORS origin allow-list — ~20 lines.
4. Strip `password` from login/signup/team responses (`.select('-password')` is already used on `/api/team` — apply everywhere) and stop persisting it in localStorage.
5. `VITE_API_URL` env for the frontend baseURL.
6. Add `/healthz` route and default `limit=100` on `GET /api/tasks`.
7. Change `scripts/importNotion.js` from `deleteMany + insert` to upsert-by-`notionId`.

---

*Bottom line: the product vision is coherent and the prototype proves it. But today this is a demo wearing production clothes — the auth/security work in Phase 0–1 is non-negotiable before your employees' passwords, salaries-adjacent timesheets, and project budgets touch it. Fix identity (auth + userId refs) first; everything else in the ERP roadmap builds on those two foundations.*
