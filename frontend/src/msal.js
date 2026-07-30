import { PublicClientApplication } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;

export const msalConfigured = Boolean(clientId && tenantId);

// Redirect flow (not popup): the whole tab navigates to Microsoft and back.
// This avoids every popup failure mode we hit in production (COOP severing the
// opener link, nested-popup guards, popup blockers) and is MSAL's recommended
// flow for SPAs. The redirect URI is the app root — MSAL strips the auth hash
// off the URL after processing it on load.
export const msalInstance = msalConfigured
  ? new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
        navigateToLoginRequestUrl: false,
      },
      cache: { cacheLocation: 'sessionStorage' },
    })
  : null;

let initialized = false;
export async function ensureMsalInitialized() {
  if (!msalInstance) throw new Error('Microsoft SSO is not configured');
  if (!initialized) {
    await msalInstance.initialize();
    initialized = true;
  }
  return msalInstance;
}

/**
 * Clears MSAL's "interaction in progress" flag. It lives in sessionStorage and
 * is meant to be cleared when an auth flow resolves/rejects — but if a prior
 * attempt was interrupted uncleanly (tab closed mid-flow, misconfigured
 * redirect), it can get stuck and block every future sign-in with
 * `interaction_in_progress` even though nothing is actually running.
 */
export function clearStuckInteractionState() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('msal.') || key.includes('interaction.status')) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // sessionStorage unavailable (e.g. privacy mode) — nothing to clear
  }
}

/** Starts the sign-in: navigates this tab to the Microsoft login page. */
export async function startMicrosoftSignIn() {
  const instance = await ensureMsalInitialized();
  try {
    await instance.loginRedirect({
      scopes: ['openid', 'profile', 'email'],
      prompt: 'select_account',
    });
  } catch (err) {
    if (err.errorCode === 'interaction_in_progress') {
      // Stale flag from an earlier interrupted attempt — clear it and retry once.
      clearStuckInteractionState();
      await instance.loginRedirect({
        scopes: ['openid', 'profile', 'email'],
        prompt: 'select_account',
      });
      return;
    }
    throw err;
  }
}

/**
 * Call once on app load. If the page load is the return leg of a sign-in
 * redirect, returns the ID token; otherwise returns null.
 */
export async function completeMicrosoftSignIn() {
  if (!msalConfigured) return null;
  const instance = await ensureMsalInitialized();
  const result = await instance.handleRedirectPromise();
  return result?.idToken || null;
}
