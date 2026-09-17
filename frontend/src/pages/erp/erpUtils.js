// Pure helpers shared by the ERP pages (no React exports here — keeps react-refresh happy).

export const pad = (n) => String(n).padStart(2, '0');

/** minutes → "08:30" */
export const fmtHM = (min) => { const m = Math.max(0, Math.round(min || 0)); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
/** signed minutes → "-02:30" */
export const fmtHMSigned = (min) => (min < 0 ? '-' : '') + fmtHM(Math.abs(min));
/** "8", "8.5", "8:30", "0830" → minutes (null when unparsable) */
export const parseHM = (s) => {
  const t = String(s ?? '').trim(); if (!t) return 0;
  let m;
  if ((m = t.match(/^(\d{1,2}):(\d{1,2})$/))) return Math.min(1440, Number(m[1]) * 60 + Number(m[2]));
  if (/^\d{1,2}\.\d{1,2}$/.test(t)) return Math.min(1440, Math.round(Number(t) * 60));
  if ((m = t.match(/^(\d{1,2})$/))) return Math.min(1440, Number(m[1]) * 60);
  if ((m = t.match(/^(\d{2})(\d{2})$/))) return Math.min(1440, Number(m[1]) * 60 + Number(m[2]));
  return null;
};
export const fmtH = (h, d = 1) => (Number(h) || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const fmtPct = (n) => `${(Number(n) || 0).toFixed(1)}%`;
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fyOf = (dateIso = todayIso()) => { const y = Number(dateIso.slice(0, 4)); const m = Number(dateIso.slice(5, 7)); return m >= 4 ? y : y - 1; };
export const fyRange = (fy) => ({ from: `${fy}-04-01`, to: `${fy + 1}-03-31` });
export const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const dayLabel = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${pad(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`; };
export const sum = (a) => (a || []).reduce((x, y) => x + (Number(y) || 0), 0);

/** Cross-page navigation with parameters (the app router only carries the page name in the hash). */
export const erpJump = (page, params = {}) => {
  try { sessionStorage.setItem('erp_jump', JSON.stringify({ page, params, at: Date.now() })); } catch { /* ignore */ }
  window.location.hash = `/${page}`;
};
export const erpTakeJump = (page) => {
  try {
    const raw = sessionStorage.getItem('erp_jump'); if (!raw) return null;
    const j = JSON.parse(raw); if (j.page !== page) return null;
    sessionStorage.removeItem('erp_jump'); return j.params || null;
  } catch { return null; }
};

/** Download rows as CSV (array of arrays). */
export const downloadCsv = (name, rows) => {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export const errMsg = (e, fallback = 'Something went wrong') => e?.response?.data?.message || e?.response?.data?.error || e?.message || fallback;

export const STATUS_LABEL = { draft: 'Draft', submitted: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected', missing: 'Not started' };
