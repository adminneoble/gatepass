import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import QrScanner from 'qr-scanner';
import { ArrowRight, BadgeCheck, Delete, ScanLine, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { fmtMobile } from '../../lib/format';
import type { Pass } from '../../lib/types';
import { Button, Notice, Sheet, Tag, css } from '../../ui';

type Result = { ok: true; pass: Pass } | { ok: false; message: string };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Del'] as const;

export default function Verify() {
  const { toast, fail } = useFeedback();
  const [code, setCode] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [scanning, setScanning] = useState(false);
  const timer = useRef<number>(0);

  const verify = useMutation({
    mutationFn: (b: { code?: string; token?: string }) => api.post<Result>('/passes/verify', b),
    onSuccess: setRes,
    onError: fail,
  });
  const admit = useMutation({
    mutationFn: (p: Pass) => api.post(`/passes/${p.id}/admit`),
    onSuccess: (_d, p) => { toast(`${p.name} allowed into ${p.unitId}`); put(''); setRes(null); },
    onError: fail,
  });

  const codeRef = useRef('');
  const put = (c: string) => { codeRef.current = c; setCode(c); };

  const press = useCallback((k: string) => {
    const c = codeRef.current;
    const next = k === 'Clear' ? '' : k === 'Del' ? c.slice(0, -1) : c.length < 6 ? c + k : c;
    put(next);
    setRes(null);
    clearTimeout(timer.current);
    // Short delay so a reader typing a longer ID isn't cut off at six digits.
    if (next.length === 6 && /\d/.test(k)) timer.current = window.setTimeout(() => verify.mutate({ code: next }), 150);
  }, [verify]);

  const scanned = useCallback((text: string) => { setScanning(false); put(''); setRes(null); verify.mutate({ token: text }); }, [verify]);

  // Physical keyboard + USB/Bluetooth QR or RFID readers (which "type" fast and press Enter).
  useEffect(() => {
    let buf = '', last = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [role="dialog"]')) return;
      const now = performance.now();
      if (now - last > 80) buf = '';
      last = now;
      if (e.key === 'Enter') {
        if (buf.length > 6) { clearTimeout(timer.current); scanned(buf); }
        buf = '';
        return;
      }
      if (e.key.length === 1) buf += e.key;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('Del');
      else if (e.key === 'Escape') press('Clear');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, scanned]);

  const state = res ? (res.ok ? 'ok' : 'error') : '';
  return (
    <main className="content shell-col" style={css({ '--col': '480px' })}>
      <Button size="lg" block icon={ScanLine} onClick={() => setScanning(true)} trail={<span className="micro">Camera</span>}>Scan QR / RFID pass</Button>
      <div className="row" style={css({ '--gap': '10px' })}><hr className="hair grow" /><span className="kicker">Or enter the 6-digit code</span><hr className="hair grow" /></div>

      <div className={'code-boxes ' + state} style={css({ '--n': 6 })} aria-live="polite" aria-label={`Code ${code.split('').join(' ')}`}>
        {Array.from({ length: 6 }, (_, i) => <div key={i} className={'code-box' + (code[i] ? ' filled' : '') + (i === code.length && !res ? ' cursor' : '')}>{code[i] ?? ''}</div>)}
      </div>

      {res?.ok && (
        <section className="card ok" style={{ animation: 'pop 220ms var(--ease)' }}>
          <div className="card-head">
            <span className="kicker grow">Pre-approved by {res.pass.unitId}</span>
            <Tag tone="positive"><BadgeCheck size={12} />Valid</Tag>
          </div>
          <span className="title">{res.pass.name}</span>
          <span className="meta">{res.pass.purpose} · <span className="num">{fmtMobile(res.pass.mobile)}</span> · {res.pass.validLabel}</span>
          <Button variant="primary" size="lg" block icon={ArrowRight} loading={admit.isPending} onClick={() => admit.mutate(res.pass)}>Allow entry</Button>
        </section>
      )}
      {res && !res.ok && <Notice tone="danger" icon={TriangleAlert}>{res.message}</Notice>}

      <div className="keypad" role="group" aria-label="Keypad">
        {KEYS.map(k => (
          <button key={k} type="button" className={'key' + (k.length > 1 ? ' text' : '')} aria-label={k === 'Del' ? 'Backspace' : k} onClick={() => press(k)}>
            {k === 'Del' ? <Delete size={22} /> : k}
          </button>
        ))}
      </div>
      {scanning && <ScannerSheet onResult={scanned} onClose={() => setScanning(false)} />}
    </main>
  );
}

function ScannerSheet({ onResult, onClose }: { onResult: (t: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!video.current) return;
    const s = new QrScanner(video.current, r => onResult(r.data), { returnDetailedScanResult: true, highlightScanRegion: true, preferredCamera: 'environment' });
    s.start().catch(() => setError('Camera is not available. Allow camera access, or use a connected QR/RFID reader or the keypad.'));
    return () => { s.stop(); s.destroy(); };
  }, [onResult]);
  return (
    <Sheet title="Scan pass" sub="Point the camera at the visitor's QR code." onClose={onClose}>
      <div style={{ position: 'relative', background: '#000', aspectRatio: '1', overflow: 'hidden' }}>
        <video ref={video} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
      </div>
      {error && <Notice tone="danger" icon={TriangleAlert}>{error}</Notice>}
      <span className="micro">USB and Bluetooth readers work without opening this — just scan on the Verify screen.</span>
    </Sheet>
  );
}
