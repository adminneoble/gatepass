import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadUser } from './auth.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { flush } from './lib/realtime.js';
import { core } from './routes/core.js';
import { gate } from './routes/gate.js';
import { member } from './routes/member.js';
import { admin } from './routes/admin.js';
import { notices } from './routes/notices.js';

/** Browser-facing origin of this request (Vercel proxies /api here, so prefer Origin/Referer). */
function originOf(req: Request) {
  for (const h of [req.get('origin'), req.get('referer')]) {
    try { if (h) { const u = new URL(h); if (!u.hostname.endsWith('.supabase.co')) return u.origin; } } catch { /* ignore */ }
  }
  return null;
}

/** Record the time since the previous lap under `name` (sent as a Server-Timing header). */
function lap(res: Response, name: string) {
  const now = performance.now();
  (res.locals.timing as [string, number][]).push([name, now - res.locals.mark]);
  res.locals.mark = now;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    if (!config.publicUrlFixed) { const o = originOf(req); if (o) config.publicUrl = o; }
    // Server-Timing: `up` is how long this process had been running when the request arrived.
    res.locals.timing = [['up', performance.now()]];
    res.locals.mark = performance.now();
    next();
  });
  app.use((_req, res, next) => { bootstrap().then(() => { lap(res, 'init'); next(); }, next); });
  // Live updates queued by a handler go out before its response.
  app.use((_req, res, next) => {
    const send = res.send.bind(res);
    res.send = ((body?: unknown) => {
      lap(res, 'handler');
      flush().finally(() => {
        lap(res, 'publish');
        if (!res.headersSent) res.setHeader('Server-Timing', (res.locals.timing as [string, number][]).map(([k, v]) => `${k};dur=${v.toFixed(0)}`).join(', '));
        send(body);
      });
      return res;
    }) as typeof res.send;
    next();
  });

  // Notices may carry a photo/PDF attachment (≤5 MB, base64 in JSON); everything else stays small.
  const jsonSmall = express.json({ limit: '1mb' }), jsonLarge = express.json({ limit: '8mb' });
  app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/admin/notices' ? jsonLarge : jsonSmall)(req, res, next));
  app.use(cookieParser());
  app.use(loadUser);
  app.use((_req, res, next) => { lap(res, 'session'); next(); });

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api', core, gate, member, admin, notices);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // Serve the built web app when running as one Node process (not on Supabase/Vercel).
  let web: string | null = null;
  try { web = fileURLToPath(new URL('../../web/dist', import.meta.url)); } catch { /* bundled */ }
  if (web && existsSync(web)) {
    app.use(express.static(web, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(web + '/index.html'));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
