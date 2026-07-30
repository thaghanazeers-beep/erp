import { PublicClientApplication } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;

export const msalConfigured = Boolean(clientId && tenantId);

export const msalInstance = msalConfigured
  ? new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        // Dedicated blank page (not the app root) — the auth popup navigates
        // here after sign-in and just closes itself, instead of re-mounting
        // the whole SPA inside the popup (which trips MSAL's nested-popup guard).
        redirectUri: `${window.location.origin}/blank.html`,
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
 * is meant to be cleared when a login popup resolves/rejects — but if a prior
 * attempt was interrupted uncleanly (popup closed, redirect URI misconfigured,
 * tab closed mid-flow), it can get stuck and block every future sign-in with
 * `interaction_in_progress` even though nothing is actually running.
 */
function clearStuckInteractionState() {
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

/** Runs the Microsoft sign-in popup and returns the ID token. */
export async function signInWithMicrosoft() {
  const instance = await ensureMsalInitialized();
  try {
    const result = await instance.loginPopup({
      scopes: ['openid', 'profile', 'email'],
      prompt: 'select_account',
    });
    return result.idToken;
  } catch (err) {
    if (err.errorCode === 'interaction_in_progress') {
      // Stale flag from an earlier interrupted attempt — clear it and retry once.
      clearStuckInteractionState();
      const result = await instance.loginPopup({
        scopes: ['openid', 'profile', 'email'],
        prompt: 'select_account',
      });
      return result.idToken;
    }
    throw err;
  }
}
