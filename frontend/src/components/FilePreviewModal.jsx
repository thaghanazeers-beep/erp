import { useState, useEffect, useCallback } from 'react';
import { downloadAttachmentBlob, getAttachmentSignedUrl } from '../api';
import FileTypeIcon from './FileTypeIcon';
import './FilePreviewModal.css';

const KIND_BY_EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],
  pdf: ['pdf'],
  office: ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'],
  text: ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yml', 'yaml', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'sh', 'py', 'sql'],
};

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  pdf: 'application/pdf',
};

const extOf = (name) => (name || '').split('.').pop().toLowerCase();
const kindOf = (name) => {
  const ext = extOf(name);
  for (const [kind, exts] of Object.entries(KIND_BY_EXT)) {
    if (exts.includes(ext)) return kind;
  }
  return 'none';
};

export default function FilePreviewModal({ attachment, onClose, onDownload }) {
  const kind = kindOf(attachment.name);
  const key = attachment.path?.split('/').pop();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [src, setSrc] = useState(null);       // object URL or viewer URL
  const [textBody, setTextBody] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setSrc(null);
    setTextBody(null);

    (async () => {
      try {
        if (kind === 'none') {
          setLoading(false);
          return;
        }
        if (kind === 'office') {
          // The Office viewer runs on Microsoft's servers, so it gets a
          // signed, expiring public link instead of our auth-gated blob.
          const res = await getAttachmentSignedUrl(key);
          if (cancelled) return;
          setSrc(`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(res.data.url)}`);
        } else {
          const res = await downloadAttachmentBlob(key);
          if (cancelled) return;
          if (kind === 'text') {
            setTextBody(await res.data.text());
          } else {
            const mime = MIME_BY_EXT[extOf(attachment.name)] || res.data.type;
            objectUrl = URL.createObjectURL(new Blob([res.data], { type: mime }));
            setSrc(objectUrl);
          }
        }
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.path]);

  const handleKey = useCallback((e) => { if (e.key === 'Escape') onClose(); }, [onClose]);
  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // Media (image/video/pdf/office) hides the modal chrome background; iframe kinds fill the body.
  const fillKinds = ['pdf', 'office'];

  return (
    <div className="fp-overlay" onClick={onClose}>
      <div className="fp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fp-header">
          <div className="fp-title">
            <FileTypeIcon name={attachment.name} size={16} />
            <span className="fp-name" title={attachment.name}>{attachment.name}</span>
          </div>
          <div className="fp-actions">
            <button className="btn btn-ghost btn-sm" onClick={onDownload}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download
            </button>
            <button className="btn-icon" onClick={onClose} title="Close (Esc)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div className={`fp-body ${fillKinds.includes(kind) ? 'fp-body-fill' : ''}`}>
          {loading && <div className="fp-center"><span className="spinner" style={{ width: 28, height: 28, borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} /></div>}

          {!loading && error && (
            <div className="fp-center fp-fallback">
              <FileTypeIcon name={attachment.name} size={40} />
              <p>Preview failed to load.</p>
              <button className="btn btn-primary btn-sm" onClick={onDownload}>Download file</button>
            </div>
          )}

          {!loading && !error && kind === 'image' && <img className="fp-image" src={src} alt={attachment.name} />}
          {!loading && !error && kind === 'video' && <video className="fp-video" src={src} controls autoPlay />}
          {!loading && !error && kind === 'audio' && (
            <div className="fp-center fp-audio-wrap">
              <FileTypeIcon name={attachment.name} size={40} />
              <audio src={src} controls autoPlay style={{ width: 'min(480px, 90%)' }} />
            </div>
          )}
          {!loading && !error && (kind === 'pdf' || kind === 'office') && (
            <iframe className="fp-frame" src={src} title={attachment.name} allowFullScreen />
          )}
          {!loading && !error && kind === 'text' && <pre className="fp-text">{textBody}</pre>}
          {!loading && !error && kind === 'none' && (
            <div className="fp-center fp-fallback">
              <FileTypeIcon name={attachment.name} size={40} />
              <p>No preview available for this file type.</p>
              <button className="btn btn-primary btn-sm" onClick={onDownload}>Download file</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
