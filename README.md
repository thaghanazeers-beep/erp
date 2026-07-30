# Mayvel ERP — Workspace & Task Management

Notion-style task management + ERP platform for Mayvel. React SPA + Express API + MongoDB Atlas,
deployed as a single service. Authentication is **Microsoft SSO only** (Entra ID).

**Production:** https://erp.mayvel.ai

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite (`frontend/`) |
| Backend | Node 20 + Express 5 + Mongoose (`backend/`) |
| Database | MongoDB Atlas |
| Auth | Microsoft Entra ID (MSAL) → app JWT, server-side RBAC |

## Local development

```bash
# 1. Configure env (see backend/.env.example and frontend/.env.example)
cp backend/.env.example backend/.env    # then fill values
cp frontend/.env.example frontend/.env  # then fill values

# 2. Install & run
cd backend  && npm install && npm start       # API on :3000
cd frontend && npm install && npm run dev     # SPA on :5173
```

Microsoft SSO setup (one-time Azure app registration): see [SSO_SETUP.md](SSO_SETUP.md).

## Production

Single service: `npm install && npm run build && npm start` from the repo root —
Express serves the built SPA, `/api/*`, `/uploads/*`, and `/healthz`.
Deployment runbook: see [DEPLOYMENT.md](DEPLOYMENT.md).

## Docs

- [DEPLOYMENT.md](DEPLOYMENT.md) — Hostinger + Azure + Atlas production runbook
- [SSO_SETUP.md](SSO_SETUP.md) — Microsoft SSO configuration
- [TECHNICAL_AUDIT.md](TECHNICAL_AUDIT.md) — security audit, fixes, and ERP roadmap
- [PRD.md](PRD.md) — product requirements
