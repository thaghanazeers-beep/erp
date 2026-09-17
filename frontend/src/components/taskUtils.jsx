// Small presentational helpers shared by the task board and the task panel.
// Kept out of the component files so React Fast Refresh stays component-only.

// Soft background / strong foreground pairs, picked deterministically per tag
const TAG_PALETTE = [
  ['rgba(35,131,226,.14)', '#1b6fc2'], ['rgba(46,158,107,.16)', '#1f7a4d'], ['rgba(217,115,13,.16)', '#b3560a'],
  ['rgba(182,76,133,.16)', '#9a3f70'], ['rgba(124,92,191,.16)', '#5b3fa8'], ['rgba(15,157,157,.16)', '#0b7676'],
];
export const tagColor = (tag = '') =>
  TAG_PALETTE[[...String(tag)].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_PALETTE.length];

export const relTime = (d) => {
  if (!d) return '';
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const dd = Math.floor(h / 24); if (dd < 7) return `${dd} day${dd === 1 ? '' : 's'} ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Lightweight rich text for comments: **bold** _italic_ __underline__ ~~strike~~ [text](url) @Name https://…
// Rendered as React nodes (never innerHTML) so comment text is always safe.
const RICH_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\)|@[A-Za-z][\w.'-]*(?: [A-Z][\w.'-]*)*|https?:\/\/[^\s)]+)/g;
export function renderRich(text = '') {
  return String(text).split(RICH_RE).map((p, i) => {
    if (!p) return null;
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^__[^_]+__$/.test(p)) return <u key={i}>{p.slice(2, -2)}</u>;
    if (/^~~[^~]+~~$/.test(p)) return <s key={i}>{p.slice(2, -2)}</s>;
    if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a>;
    if (p.startsWith('@')) return <span key={i} className="tp-mention">{p}</span>;
    return <span key={i}>{p}</span>;
  });
}
