import { PublicClientApplication } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;

export const msalConfigured = Boolean(clientId && tenantId);

export const msalInstance = msalConfigured
  ? new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
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

/** Runs the Microsoft sign-in popup and returns the ID token. */
export async function signInWithMicrosoft() {
  const instance = await ensureMsalInitialized();
  const result = await instance.loginPopup({
    scopes: ['openid', 'profile', 'email'],
    prompt: 'select_account',
  });
  return result.idToken;
}
