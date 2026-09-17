import { useState } from 'react';
import './Avatar.css';

const PALETTE = ['#2383e2', '#2e9e6b', '#d9730d', '#b64c85', '#7c5cbf', '#d44c47', '#0f9d9d', '#8a6d3b'];
const colorFor = (name = '') =>
  PALETTE[[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

// The default avatar: a generic person silhouette on a per-person tint. Shown
// whenever someone has no photo, or their photo URL fails to load (e.g. the
// file was wiped on a redeploy) — so a broken-image icon never appears.
function Silhouette() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 12.5a4.75 4.75 0 1 0 0-9.5 4.75 4.75 0 0 0 0 9.5Zm0 2c-4.4 0-8.5 2.3-8.5 5.7V21h17v-.8c0-3.4-4.1-5.7-8.5-5.7Z" />
    </svg>
  );
}

/**
 * Single source of truth for profile pictures.
 *   name     — person's display name (tint + alt text)
 *   src      — explicit photo URL; omit to look the person up in `members`
 *   members  — team list (name → profilePictureUrl) when `src` is not given
 *   size     — pixel size; or pass `fill` to fill a parent container instead
 */
export default function Avatar({ name, src, members = [], size = 22, fill = false, className = '', title }) {
  const [brokenUrl, setBrokenUrl] = useState(null);
  const url = src !== undefined ? src : members.find(x => x.name === name)?.profilePictureUrl;
  const dim = fill ? { width: '100%', height: '100%' } : { width: size, height: size };
  const label = title || name || 'User';
  const cls = `av ${fill ? 'av-fill' : ''} ${className}`.trim();

  if (url && brokenUrl !== url) {
    return <img className={cls} src={url} alt={label} title={label} style={dim} onError={() => setBrokenUrl(url)} />;
  }
  return (
    <span className={`${cls} av-default`} role="img" aria-label={label} title={label} style={{ ...dim, background: colorFor(name) }}>
      <Silhouette />
    </span>
  );
}

export function AvatarStack({ names = [], members = [], size = 22, max = 3 }) {
  const uniq = [...new Set(names.filter(Boolean))];
  const shown = uniq.slice(0, max);
  const extra = uniq.length - shown.length;
  if (!uniq.length) return null;
  return (
    <span className="av-stack">
      {shown.map(n => <Avatar key={n} name={n} members={members} size={size} />)}
      {extra > 0 && (
        <span className="av av-more" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} title={uniq.slice(max).join(', ')}>
          +{extra}
        </span>
      )}
    </span>
  );
}
