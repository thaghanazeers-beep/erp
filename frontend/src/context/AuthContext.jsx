import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('mayvel_user');
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved);
      delete parsed.password; // scrub any legacy stored credential
      // A user without a token is a stale pre-SSO session — force re-login
      if (!localStorage.getItem('mayvel_token')) return null;
      return parsed;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem('mayvel_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('mayvel_user');
      localStorage.removeItem('mayvel_token');
    }
  }, [user]);

  /** loginUser(userData, token) — token optional when only refreshing profile data. */
  const loginUser = (userData, token) => {
    if (token) localStorage.setItem('mayvel_token', token);
    setUser(userData);
  };

  const logout = () => setUser(null);

  return (
    <AuthContext.Provider value={{ user, loginUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
