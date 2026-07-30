import { useState, useEffect } from 'react';
import { loginWithMicrosoft } from '../api';
import { useAuth } from '../context/AuthContext';
import { msalConfigured, startMicrosoftSignIn, completeMicrosoftSignIn } from '../msal';
import './AuthPage.css';

export default function AuthPage() {
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(true); // true while we check for a redirect return
  const [error, setError] = useState('');
  const { loginUser } = useAuth();

  // If this page load is the return leg of the Microsoft redirect,
  // finish the sign-in: exchange the Microsoft ID token for our app session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idToken = await completeMicrosoftSignIn();
        if (idToken && !cancelled) {
          const res = await loginWithMicrosoft(idToken);
          if (!cancelled) loginUser(res.data.user, res.data.token);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || err.errorMessage || err.message || 'Sign-in failed. Please try again.');
        }
      } finally {
        if (!cancelled) setCompleting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loginUser]);

  const handleMicrosoftSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await startMicrosoftSignIn(); // navigates away — nothing runs after this on success
    } catch (err) {
      setError(err.response?.data?.message || err.errorMessage || err.message || 'Sign-in failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
        <div className="auth-orb auth-orb-3" />
      </div>

      <div className="auth-card animate-in">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="2"/>
              <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1>Mayvel Task</h1>
        </div>

        <p className="auth-subtitle">Sign in with your Mayvel Microsoft account</p>

        {error && <div className="auth-error">{error}</div>}

        {!msalConfigured && (
          <div className="auth-error">
            Microsoft SSO is not configured yet. Set <code>VITE_AZURE_CLIENT_ID</code> and{' '}
            <code>VITE_AZURE_TENANT_ID</code> in <code>frontend/.env</code> (see SSO_SETUP.md), then restart the dev server.
          </div>
        )}

        <button
          className="btn btn-primary auth-submit"
          onClick={handleMicrosoftSignIn}
          disabled={loading || completing || !msalConfigured}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
        >
          {loading || completing ? (
            <span className="spinner" />
          ) : (
            <>
              {/* Microsoft logo */}
              <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </>
          )}
        </button>

        <p className="auth-toggle" style={{ marginTop: 16 }}>
          Access is managed by your organization — no password needed.
        </p>
      </div>
    </div>
  );
}
