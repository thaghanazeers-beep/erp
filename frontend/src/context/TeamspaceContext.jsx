import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const TeamspaceContext = createContext();

export function TeamspaceProvider({ children }) {
  const { user } = useAuth();
  const [activeTeamspaceId, setActiveTeamspaceId] = useState(() => {
    const val = localStorage.getItem('mayvel_activeTeamspace');
    return (val === 'undefined' || val === 'null' || !val) ? '' : val;
  });

  useEffect(() => {
    localStorage.setItem('mayvel_activeTeamspace', activeTeamspaceId || '');
  }, [activeTeamspaceId]);

  return (
    <TeamspaceContext.Provider value={{ activeTeamspaceId, setActiveTeamspaceId }}>
      {children}
    </TeamspaceContext.Provider>
  );
}

export function useTeamspace() {
  return useContext(TeamspaceContext);
}
