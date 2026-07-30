const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

/**
 * Verifies a Microsoft Entra ID (Azure AD) ID token issued for our app.
 * - Signature checked against Microsoft's published JWKS for our tenant
 * - Audience must be our app's client ID
 * - Issuer must be our tenant's v2.0 endpoint
 */

let client = null;
function getJwksClient() {
  if (!client) {
    client = jwksClient({
      jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
      cache: true,
      cacheMaxAge: 12 * 60 * 60 * 1000, // 12h
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }
  return client;
}

function getSigningKey(header, callback) {
  getJwksClient().getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function isConfigured() {
  return !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID);
}

function verifyMicrosoftIdToken(idToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getSigningKey,
      {
        audience: process.env.AZURE_CLIENT_ID,
        issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
        algorithms: ['RS256'],
      },
      (err, decoded) => (err ? reject(err) : resolve(decoded))
    );
  });
}

module.exports = { verifyMicrosoftIdToken, isConfigured };
