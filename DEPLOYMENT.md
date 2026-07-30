# Production Deployment — erp.mayvel.ai (Hostinger)

The app deploys as **one Node.js service**: Express serves the API (`/api`), uploads (`/uploads`),
health (`/healthz`), and the built React SPA (everything else). No separate frontend hosting needed.

```
Build:  npm install   (installs backend+frontend deps via postinstall)
        npm run build (builds frontend → frontend/dist)
Start:  npm start     (node backend/server.js — serves API + SPA)
Health: GET /healthz
```

## 1. Hostinger — "Deploy Your Web App" → Connect with GitHub

1. Click **Connect with GitHub** and authorize Hostinger to access the repo
2. Select the repository (e.g. `mayvel-erp`), branch `main`
3. If asked for framework: **Node.js** (not static/Vite — the server must run)
4. Commands (if the defaults aren't picked up automatically):
   - Install: `npm install`
   - Build: `npm run build`
   - Start: `npm start`
   - Node version: **20+**
5. **Domain:** assign `erp.mayvel.ai` to the app (Hostinger provisions TLS automatically).
   If the domain's DNS is elsewhere, point a CNAME/A record at the target Hostinger gives you.

## 2. Hostinger — Environment variables (set ALL of these in the dashboard)

| Variable | Value |
|---|---|
| `MONGODB_URI` | your Atlas connection string |
| `JWT_SECRET` | fresh value for prod: `openssl rand -hex 32` (do NOT reuse the dev one) |
| `AZURE_TENANT_ID` | from the Azure App Registration |
| `AZURE_CLIENT_ID` | from the Azure App Registration |
| `VITE_AZURE_TENANT_ID` | same tenant ID (used at **build** time by the SPA) |
| `VITE_AZURE_CLIENT_ID` | same client ID (used at **build** time by the SPA) |
| `ADMIN_EMAILS` | `hello@mayvel.ai` (comma-separate to add more) |
| `ALLOWED_EMAIL_DOMAIN` | `mayvel.ai` (recommended for prod) |
| `CORS_ORIGIN` | `https://erp.mayvel.ai` |
| `SERVER_URL` | `https://erp.mayvel.ai` |
| `APP_URL` | `https://erp.mayvel.ai` |
| `NOTION_TOKEN` | (optional) for Notion sync — use the **rotated** token |
| `NOTION_TASKS_DB` | (optional) Notion tasks data-source id |
| `SMTP_HOST/PORT/USER/PASS` | (optional) for invite emails |

> `VITE_*` vars must be present **during the build step** — they're baked into the SPA bundle.

## 3. Azure — add the production redirect URI

Portal → Entra ID → App registrations → *Mayvel Task* → **Authentication** →
**Single-page application** → add redirect URI:

```
https://erp.mayvel.ai
```

(keep `http://localhost:5173` for local dev)

## 4. MongoDB Atlas — allow Hostinger to connect

Atlas → Network Access → add the app's outbound IP(s) from Hostinger,
or temporarily `0.0.0.0/0` (allow-all) to get live — tighten to specific IPs after.
Also verify: **Backup** is enabled on your cluster tier (M2+ has snapshots).

## 5. First deploy checklist

- [ ] `https://erp.mayvel.ai/healthz` returns `{"ok":true,"db":"connected"}`
- [ ] Login page loads, **Sign in with Microsoft** completes (popup → back to app)
- [ ] `hello@mayvel.ai` lands as **Admin** (check Profile page)
- [ ] Tasks/projects/sprints load (imported Notion data visible)
- [ ] A second (non-admin) employee can sign in and sees Member permissions
- [ ] `https://erp.mayvel.ai/api/tasks` **without** login returns 401
- [ ] Uploaded avatar displays (uploads work)

## Security notes for production

- **Rotate before go-live:** the old Notion token and the Atlas password were once committed
  in plaintext — regenerate both; use the new values only in Hostinger env vars.
- `JWT_SECRET` in prod must differ from dev. Rotating it force-logs-out everyone (harmless).
- Uploads (`backend/uploads/`) live on the app's disk — they do **not** survive every redeploy
  on some platforms. Acceptable for avatars now; move to S3-compatible storage later.
- The hourly workflow scheduler runs inside the web process — run **one instance** of the app
  (scaling to multiple instances will double-fire reminders; move to a worker before scaling).

## Rollback

Hostinger keeps previous deployments — redeploy the prior commit from the dashboard,
or `git revert` + push (auto-deploys if auto-deploy on push is enabled).
