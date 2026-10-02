import { useRef, useState } from 'react';
import { ExternalLink, FileText, ImagePlus, Paperclip, X } from 'lucide-react';
import { useFeedback } from '../../lib/feedback';

export type AttachmentInfo = { name: string; mime: string; size: number; kind: 'pdf' | 'image'; url: string };
export type PickedFile = { name: string; data: string; mime: string; size: number; preview?: string };

export const MAX_FILE = 5 * 1024 * 1024;
export const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Shown on a notice: photo thumbnail, or a PDF file row. Opens in a new tab. */
export function AttachmentView({ a }: { a: AttachmentInfo }) {
  if (a.kind === 'image') {
    return (
      <a className="attach-photo" href={a.url} target="_blank" rel="noreferrer" title={`Open ${a.name}`}>
        <img src={a.url} alt={a.name} loading="lazy" />
        <span className="attach-cap"><Paperclip size={12} />{a.name} · {fmtSize(a.size)}</span>
      </a>
    );
  }
  return (
    <a className="attach-file" href={a.url} target="_blank" rel="noreferrer">
      <span className="icon-tile toned tone-sky"><FileText size={18} /></span>
      <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
        <span className="row-title ellipsis" style={{ fontSize: 14 }}>{a.name}</span>
        <span className="row-sub">PDF · {fmtSize(a.size)}</span>
      </span>
      <span className="attach-open"><ExternalLink size={14} />Open</span>
    </a>
  );
}

/** Large photos are shrunk (longest side 2000 px, JPEG) so they fit under 5 MB and load fast on phones. */
function shrinkImage(file: File): Promise<{ data: string; size: number; mime: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const data = c.toDataURL('image/jpeg', 0.85);
      resolve({ data, size: Math.round((data.length - data.indexOf(',') - 1) * 0.75), mime: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
const readAsDataUrl = (file: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read that file.')); r.readAsDataURL(file); });

/** Picker for one photo (JPG/PNG) or PDF, with preview and remove. */
export function AttachmentPicker({ value, onChange }: { value: PickedFile | null; onChange: (f: PickedFile | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { fail } = useFeedback();
  const pick = async (file?: File) => {
    if (!file) return;
    const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
    if (!OK_TYPES.includes(type)) return fail(new Error('Attach a PDF, JPG or PNG file.'));
    setBusy(true);
    try {
      if (type === 'application/pdf') {
        if (file.size > MAX_FILE) throw new Error(`That PDF is ${fmtSize(file.size)}. The limit is 5 MB.`);
        onChange({ name: file.name, data: await readAsDataUrl(file), mime: type, size: file.size });
      } else if (file.size > MAX_FILE) {
        const s = await shrinkImage(file);
        if (s.size > MAX_FILE) throw new Error('That photo is too large even after compressing. Try a smaller one.');
        onChange({ name: file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg', ...s, preview: s.data });
      } else {
        const data = await readAsDataUrl(file);
        onChange({ name: file.name, data, mime: type, size: file.size, preview: data });
      }
    } catch (e) { fail(e); }
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  return (
    <div className="field">
      <span className="field-label">Attachment (optional)</span>
      {value ? (
        <div className="attach-picked">
          {value.preview ? <img src={value.preview} alt="" /> : <span className="icon-tile toned tone-sky"><FileText size={18} /></span>}
          <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
            <span className="row-title ellipsis" style={{ fontSize: 14 }}>{value.name}</span>
            <span className="row-sub">{value.mime === 'application/pdf' ? 'PDF' : 'Photo'} · {fmtSize(value.size)}</span>
          </span>
          <button type="button" className="icon-btn" aria-label="Remove attachment" onClick={() => onChange(null)}><X size={18} /></button>
        </div>
      ) : (
        <button type="button" className="attach-drop" disabled={busy} onClick={() => input.current?.click()}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
          <ImagePlus size={20} />
          <span className="stack" style={{ gap: 0 }}>
            <strong>{busy ? 'Reading file…' : 'Add a photo or PDF'}</strong>
            <span className="micro">JPG, PNG or PDF · up to 5 MB · tap or drop a file</span>
          </span>
        </button>
      )}
      <input ref={input} type="file" hidden accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={e => pick(e.target.files?.[0])} />
    </div>
  );
}
