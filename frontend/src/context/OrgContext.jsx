import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getOrgChart, getOrgHierarchy } from '../api';
import { useTeamspace } from './TeamspaceContext';

const OrgContext = createContext();

export function OrgProvider({ children }) {
  const { activeTeamspaceId } = useTeamspace();
  const [orgChart, setOrgChart] = useState({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);

  // Build lookup maps
  const [parentMap, setParentMap] = useState({});  // nodeId → parentNodeId
  const [childMap, setChildMap] = useState({});    // nodeId → [childNodeIds]
  const [memberNodeMap, setMemberNodeMap] = useState({}); // memberId → node

  const refresh = useCallback(async () => {
    try {
      const res = await getOrgChart(activeTeamspaceId || '');
      const chart = res.data;
      setOrgChart(chart);

      // Build adjacency maps
      const pm = {};
      const cm = {};
      const mm = {};
      (chart.edges || []).forEach(e => {
        pm[e.to] = e.from;
        if (!cm[e.from]) cm[e.from] = [];
        cm[e.from].push(e.to);
      });
      (chart.nodes || []).forEach(n => {
        if (n.memberId) mm[n.memberId] = n;
      });
      setParentMap(pm);
      setChildMap(cm);
      setMemberNodeMap(mm);
    } catch (err) {
      console.error('Failed to load org chart:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTeamspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  // ─── Helper Functions ─────────────────────────────────────

  // Get the org node for a member (by User._id)
  const getNodeForMember = (memberId) => memberNodeMap[memberId] || null;

  // Get the org role/title for a member
  const getOrgRole = (memberId) => memberNodeMap[memberId]?.orgRole || null;

  // Check if memberA is a manager (direct or indirect) of memberB
  const isManagerOf = (managerMemberId, subordinateMemberId) => {
    const managerNode = memberNodeMap[managerMemberId];
    const subNode = memberNodeMap[subordinateMemberId];
    if (!managerNode || !subNode) return false;

    let current = subNode.id;
    while (parentMap[current]) {
      if (parentMap[current] === managerNode.id) return true;
      current = parentMap[current];
    }
    return false;
  };

  // Get direct reports of a member
  const getDirectReports = (memberId) => {
    const node = memberNodeMap[memberId];
    if (!node) return [];
    return (childMap[node.id] || [])
      .map(cid => orgChart.nodes.find(n => n.id === cid))
      .filter(Boolean);
  };

  // Get all subordinates (recursive) of a member
  const getAllSubordinates = (memberId) => {
    const node = memberNodeMap[memberId];
    if (!node) return [];
    const result = [];
    const queue = [...(childMap[node.id] || [])];
    while (queue.length) {
      const cid = queue.shift();
      const cNode = orgChart.nodes.find(n => n.id === cid);
      if (cNode) {
        result.push(cNode);
        (childMap[cid] || []).forEach(sub => queue.push(sub));
      }
    }
    return result;
  };

  // Get manager chain (walking up) for a member
  const getManagerChain = (memberId) => {
    const node = memberNodeMap[memberId];
    if (!node) return [];
    const managers = [];
    let current = node.id;
    while (parentMap[current]) {
      const parentNode = orgChart.nodes.find(n => n.id === parentMap[current]);
      if (parentNode) managers.push(parentNode);
      current = parentMap[current];
    }
    return managers;
  };

  // Check if a member has a specific org role (or higher)
  const hasOrgRole = (memberId, role) => {
    const node = memberNodeMap[memberId];
    return node?.orgRole === role;
  };

  // Check if member is at C-level
  const isCLevel = (memberId) => {
    const node = memberNodeMap[memberId];
    if (!node) return false;
    return ['CEO', 'CTO', 'COO', 'CFO', 'Founder'].includes(node.orgRole);
  };

  // Check if member is management (Director, Manager, Lead, or C-level)
  const isManagement = (memberId) => {
    const node = memberNodeMap[memberId];
    if (!node) return false;
    return ['CEO', 'CTO', 'COO', 'CFO', 'Founder', 'Director', 'Manager', 'Lead'].includes(node.orgRole);
  };

  // Can a member manage another member? (direct or indirect manager, or C-level)
  const canManage = (actorMemberId, targetMemberId) => {
    if (isCLevel(actorMemberId)) return true;
    return isManagerOf(actorMemberId, targetMemberId);
  };

  return (
    <OrgContext.Provider value={{
      orgChart,
      loading,
      refresh,
      getNodeForMember,
      getOrgRole,
      isManagerOf,
      getDirectReports,
      getAllSubordinates,
      getManagerChain,
      hasOrgRole,
      isCLevel,
      isManagement,
      canManage,
    }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  return useContext(OrgContext);
}
