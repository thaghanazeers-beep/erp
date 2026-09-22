import { useEffect, useRef, useState } from 'react';
import { startNotionSync, getNotionSyncStatus } from '../api';
import './NotionSyncButton.css';

const fmtAgo = (iso) => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleString();
};
const summary = (r) => {
  if (!r) return '';
  const parts = [`${r.tasks?.upserted ?? 0} tasks updated`];
  if (r.sprints) parts.push(`${r.sprints.created + r.sprints.adopted} sprints, ${r.sprints.linked} tasks linked`);
  return parts.join(' · ');
};

/**
 * Header button: pulls the latest tasks and sprints from Notion into Mayvel.
 * Polls the server while a sync runs (a sync started by anyone shows here) and
 * fires `NOTION_SYNCED` so the open page reloads its data when it finishes.
 */
export default function NotionSyncButton({ onToast }) {
  const [st, setSt] = useState(null);
  const wasRunning = useRef(false);
  const timer = useRef(null);

  const poll = async () => {
    try {
      const r = await getNotionSyncStatus(); const s = r.data; setSt(s);
      if (wasRunning.current && !s.running) {
        wasRunning.current = false;
        if (s.error) onToast?.({ type: 'task_rejected', title: 'Notion sync failed', message: s.error });
        else { onToast?.({ type: 'task_completed', title: 'Notion data is up to date', message: summary(s.result) }); window.dispatchEvent(new CustomEvent('NOTION_SYNCED', { detail: s.result })); }
      }
      if (s.running) { wasRunning.current = true; timer.current = setTimeout(poll, 1500); }
    } catch { /* offline; try again on next click */ }
  };
  useEffect(() => { poll(); return () => clearTimeout(timer.current); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const run = async () => {
    if (st?.running) return;
    try {
      const r = await startNotionSync(); setSt(r.data.status); wasRunning.current = true;
      onToast?.({ type: 'status_changed', title: 'Syncing with Notion', message: 'Pulling the latest tasks and sprints. This takes a moment.' });
      clearTimeout(timer.current); timer.current = setTimeout(poll, 1500);
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || 'Could not start the sync';
      if (e?.response?.status === 409) { wasRunning.current = true; poll(); }
      onToast?.({ type: 'task_rejected', title: 'Notion sync', message: msg });
    }
  };

  const running = !!st?.running;
  const title = !st ? 'Sync live data from Notion' : running ? `Syncing… ${st.progress || ''}` : st.error ? `Last sync failed: ${st.error}` : `Sync live data from Notion · last synced ${fmtAgo(st.finishedAt)}${st.result ? ' · ' + summary(st.result) : ''}`;
  return (
    <button className={`notion-sync ${running ? 'running' : ''} ${st?.error && !running ? 'failed' : ''}`} onClick={run} disabled={running || (st && !st.configured)} title={st && !st.configured ? 'Notion is not configured on the server (NOTION_TOKEN / NOTION_TASKS_DB)' : title} aria-live="polite">
      <svg className="notion-sync-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
      <span>{running ? 'Syncing…' : 'Sync Notion'}</span>
    </button>
  );
}
