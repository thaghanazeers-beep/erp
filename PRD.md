# Product Requirements Document (PRD)
## Mayvel Workspace Management Platform

### 1. Product Overview
**Name:** Mayvel Workspace
**Description:** A comprehensive, Notion-inspired project management and workflow automation platform. Designed for agile teams, Mayvel merges task management, sprint planning, customizable databases (pages), and event-driven automation into a single cohesive platform.
**Target Audience:** Cross-functional teams, agile development teams, and project managers looking for a highly customizable yet structured workflow.

### 2. Objectives & Goals
- **Consolidate Workflows:** Provide a centralized hub for tracking Tasks, organizing Projects, running Sprints, and managing Team Roles.
- **Flexibility (Notion-style):** Transition from rigid task lists to flexible "Pages" where tasks exist within embedded databases with specific views and custom filtering.
- **Automation:** Reduce manual overhead with a robust workflow engine that automates task lifecycle events (e.g., status changes triggering notifications or reassignments).
- **Access Control:** Implement granular Role-Based Access Control (RBAC) separating Admins, Team Owners, and standard Members.

### 3. Core Features & Capabilities

#### 3.1 Task Management (Databases)
- **Multi-view Support:** Board (Kanban), List, and Table views.
- **Notion-style Filtering:** Granular, stackable filter badges (Assignee, Status, Priority, Project, Dates) with an inline overlay panel.
- **Task Attributes:** Title, Description, Status, Priority (Urgent, High, Medium, Low), Assignee, Due Date, Estimated/Actual Hours.
- **Drag-and-Drop:** Intuitive Kanban board interactions for status updates.

#### 3.2 Sprint Planning & Execution
- **Sprint Lifecycle:** Planned, Active, and Completed states.
- **Dashboard:** Unified view of active, planned, and past sprints.
- **Sprint Board:** Dedicated Kanban board for tasks assigned to a specific sprint.
- **Rollover Mechanics:** Automated incomplete task rollover to subsequent sprints upon sprint completion.
- **Progress Tracking:** Real-time visual progress bars tracking completed vs. total tasks.

#### 3.3 Projects & Organization
- **Project Metatags:** Group tasks by Projects (characterized by Names, Descriptions, Colors, and Icons).
- **Project Roll-ups:** Real-time calculation of total tasks and remaining work within projects.

#### 3.4 Workflow Automation Engine
- **Visual Builder:** UI to configure automated rules (If X happens, Then do Y).
- **Triggers:** Task Created, Status Changed, Due Date Approaching, Priority Changed.
- **Actions:** Update Fields, Send Notifications, Reassign Tasks.
- **Execution Log:** Historical tracking of automation fires.

#### 3.5 Team Management & RBAC
- **Roles:** Admin, Team Owner, Member.
- **Member Management:** Admins/Owners can invite members, reset passwords, change roles, and modify profile pictures via dedicated modals.
- **Security:** Self-removal protection and role-gated UI actions.

### 4. Technical Architecture
**Frontend:**
- **Framework:** React.js (Vite/CRA)
- **Styling:** Vanilla CSS with custom properties (CSS Variables) for robust dark/light theme toggling and glassmorphism elements.
- **State Management:** React Context API (`AuthContext`, `ThemeContext`).

**Backend:**
- **Framework:** Node.js with Express.
- **Database:** MongoDB (Mongoose ODM).
- **Key Models:** `User`, `Task`, `Project`, `Sprint`, `Workflow`, `Notification`.
- **Integrations:** Legacy support for Notion API imports.

### 5. Future Roadmap
- **Phase 2 (Pages & Databases):** 
  - Migrate static `TasksPage` to dynamic `Pages`.
  - Rich-text editor for Page descriptions.
  - Multiple embedded task databases per page.
- **Phase 3 (Advanced Automations):**
  - Webhook triggers.
  - Multi-step workflow chains.
- **Phase 4 (Analytics):**
  - Sprint velocity charts.
  - Burndown metrics.
