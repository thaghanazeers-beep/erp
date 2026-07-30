import { useState } from 'react';
import { loginWithMicrosoft } from '../api';
import { useAuth } from '../context/AuthContext';
import { msalConfigured, signInWithMicrosoft } from '../msal';
import './AuthPage.css';

export default function AuthPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { loginUser } = useAuth();

  const handleMicrosoftSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const idToken = await signInWithMicrosoft();
      const res = await loginWithMicrosoft(idToken);
      loginUser(res.data.user, res.data.token);
    } catch (err) {
      if (err.errorCode === 'user_cancelled' || err.errorCode === 'popup_window_error') {
        // user closed the popup — not an error worth showing
      } else {
        setError(err.response?.data?.message || err.message || 'Sign-in failed. Please try again.');
      }
    } finally {
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
          disabled={loading || !msalConfigured}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
        >
          {loading ? (
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
