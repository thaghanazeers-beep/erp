// Maps a filename's extension to an icon + colour so attachments are
// recognizable at a glance instead of showing one generic document icon.

const TYPES = {
  pdf: { color: '#dc2626', label: 'PDF' },
  doc: { color: '#2563eb', label: 'DOC' }, docx: { color: '#2563eb', label: 'DOC' },
  odt: { color: '#2563eb', label: 'DOC' }, rtf: { color: '#2563eb', label: 'DOC' },
  xls: { color: '#16a34a', label: 'XLS' }, xlsx: { color: '#16a34a', label: 'XLS' },
  ods: { color: '#16a34a', label: 'XLS' }, csv: { color: '#16a34a', label: 'CSV' },
  ppt: { color: '#ea580c', label: 'PPT' }, pptx: { color: '#ea580c', label: 'PPT' },
  odp: { color: '#ea580c', label: 'PPT' },
  jpg: { color: '#7c3aed', kind: 'image' }, jpeg: { color: '#7c3aed', kind: 'image' },
  png: { color: '#7c3aed', kind: 'image' }, gif: { color: '#7c3aed', kind: 'image' },
  webp: { color: '#7c3aed', kind: 'image' }, svg: { color: '#7c3aed', kind: 'image' },
  bmp: { color: '#7c3aed', kind: 'image' }, heic: { color: '#7c3aed', kind: 'image' },
  mp4: { color: '#db2777', kind: 'video' }, mov: { color: '#db2777', kind: 'video' },
  avi: { color: '#db2777', kind: 'video' }, mkv: { color: '#db2777', kind: 'video' },
  webm: { color: '#db2777', kind: 'video' },
  mp3: { color: '#0891b2', kind: 'audio' }, wav: { color: '#0891b2', kind: 'audio' },
  aac: { color: '#0891b2', kind: 'audio' }, flac: { color: '#0891b2', kind: 'audio' },
  m4a: { color: '#0891b2', kind: 'audio' }, ogg: { color: '#0891b2', kind: 'audio' },
  zip: { color: '#ca8a04', kind: 'archive' }, rar: { color: '#ca8a04', kind: 'archive' },
  '7z': { color: '#ca8a04', kind: 'archive' }, tar: { color: '#ca8a04', kind: 'archive' },
  gz: { color: '#ca8a04', kind: 'archive' },
  json: { color: '#4f46e5', kind: 'code' }, xml: { color: '#4f46e5', kind: 'code' },
  html: { color: '#4f46e5', kind: 'code' }, css: { color: '#4f46e5', kind: 'code' },
  js: { color: '#4f46e5', kind: 'code' }, jsx: { color: '#4f46e5', kind: 'code' },
  ts: { color: '#4f46e5', kind: 'code' }, tsx: { color: '#4f46e5', kind: 'code' },
  py: { color: '#4f46e5', kind: 'code' }, sql: { color: '#4f46e5', kind: 'code' },
};

function extensionOf(name) {
  const dot = (name || '').lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

const ICON_BODY = {
  doc: <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
  video: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 9l5 3-5 3z" /></>,
  audio: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  archive: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M8 4v16M12 8h4M12 12h4M12 16h4" /></>,
  code: <><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>,
};

/** Renders a coloured, type-specific icon for the given filename. Falls back to a generic document icon. */
export default function FileTypeIcon({ name, size = 18 }) {
  const meta = TYPES[extensionOf(name)];
  const color = meta?.color || 'var(--primary-light)';
  const body = ICON_BODY[meta?.kind] || ICON_BODY.doc;

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {body}
    </svg>
  );
}
