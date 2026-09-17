import { useEffect, useState } from 'react';
import { erpMe, erpWeeks } from '../../api';

/** Loads the caller's ERP context once (role, reports, money access, current week). */
export function useErpMe() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { let on = true; erpMe().then(r => { if (on) setMe(r.data); }).catch(e => { if (on) setError(e?.response?.data?.message || 'Could not load ERP context'); }); return () => { on = false; }; }, []);
  return { me, error };
}

/**
 * Run an async loader when deps change. The call is deferred a tick so state
 * updates never happen synchronously inside the effect body.
 */
export function useAsync(fn, deps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { let alive = true; Promise.resolve().then(() => { if (alive) fn(() => alive); }); return () => { alive = false; }; }, deps);
}

/** Year + week picker driven by the server's week table (legacy ERP week rule). */
export function useWeeks(year) {
  const [weeks, setWeeks] = useState([]);
  useEffect(() => { let on = true; erpWeeks(year).then(r => { if (on) setWeeks(r.data); }).catch(() => {}); return () => { on = false; }; }, [year]);
  return weeks;
}
