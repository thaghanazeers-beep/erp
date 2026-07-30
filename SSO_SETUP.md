# Microsoft SSO Setup (Entra ID / Azure AD)

Mayvel Task now uses **Microsoft SSO only** — there are no passwords anywhere in the system.
One-time setup, ~5 minutes:

## 1. Register the app in Azure

1. Go to **[portal.azure.com](https://portal.azure.com)** → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Fill in:
   - **Name:** `Mayvel Task`
   - **Supported account types:** *Accounts in this organizational directory only (Single tenant)* ← important
   - **Redirect URI:** select platform **Single-page application (SPA)** and enter `http://localhost:5173`
3. Click **Register**
4. From the app's **Overview** page copy:
   - **Application (client) ID** → this is your `CLIENT_ID`
   - **Directory (tenant) ID** → this is your `TENANT_ID`

> When you deploy to a real domain later, come back to **Authentication → Single-page application** and add the production URL (e.g. `https://tasks.mayvel.ai`) as another redirect URI.

## 2. Configure the app

**`backend/.env`** — fill these two lines:
```
AZURE_TENANT_ID=<Directory (tenant) ID>
AZURE_CLIENT_ID=<Application (client) ID>
```

**`frontend/.env`** — same two values:
```
VITE_AZURE_CLIENT_ID=<Application (client) ID>
VITE_AZURE_TENANT_ID=<Directory (tenant) ID>
```

## 3. Restart both servers

```bash
# backend
cd backend && npm start
# frontend (env changes require a restart)
cd frontend && npm run dev
```

## 4. Sign in

- Open http://localhost:5173 → **Sign in with Microsoft**
- Any member of your Microsoft tenant can sign in; accounts are created automatically as **Member**
- Emails listed in `ADMIN_EMAILS` in `backend/.env` (currently `hello@mayvel.ai`) are automatically made **Admin**

## Access control knobs (backend/.env)

| Variable | Effect |
|---|---|
| `ADMIN_EMAILS` | Comma-separated emails auto-promoted to Admin on sign-in |
| `ALLOWED_EMAIL_DOMAIN` | e.g. `mayvel.ai` — rejects sign-ins from any other domain (empty = any account in your tenant) |
| `CORS_ORIGIN` | Comma-separated allowed browser origins |
| `JWT_SECRET` | Session signing key (already generated). Rotate to force-logout everyone. |

## How it works (for the record)

1. Frontend opens a Microsoft popup (MSAL.js) → user signs in with their work account (incl. MFA if your tenant enforces it)
2. Microsoft issues an **ID token** for our app
3. Backend verifies the token's **signature** (Microsoft's published keys), **audience** (our client ID) and **issuer** (our tenant) — `backend/services/microsoftAuth.js`
4. Backend finds-or-creates the user and issues a short-lived app session JWT (7 days)
5. Every API request carries that JWT; `requireAuth` middleware validates it and loads the user — role checks happen **server-side**

No client secret is needed (SPA flow), so there's nothing to leak on the frontend.
