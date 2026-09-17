import './Avatar.css';

const PALETTE = ['#2383e2', '#2e9e6b', '#d9730d', '#b64c85', '#7c5cbf', '#d44c47', '#0f9d9d', '#8a6d3b'];
const colorFor = (name = '') =>
  PALETTE[[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

// Profile picture when the team member has one, otherwise a colored initial.
export default function Avatar({ name, members = [], size = 22, className = '', title }) {
  const m = members.find(x => x.name === name);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (m?.profilePictureUrl) {
    return <img className={`av ${className}`} src={m.profilePictureUrl} alt={name} title={title || name} style={style} />;
  }
  return (
    <span className={`av ${className}`} title={title || name} style={{ ...style, background: colorFor(name) }}>
      {(name || '?').charAt(0).toUpperCase()}
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
