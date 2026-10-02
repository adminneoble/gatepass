import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadUser } from './auth.js';
import { HttpError } from './lib/errors.js';
import { core } from './routes/core.js';
import { gate } from './routes/gate.js';
import { member } from './routes/member.js';
import { admin } from './routes/admin.js';
import { notices } from './routes/notices.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Notices may carry a photo/PDF attachment (≤5 MB, base64 in JSON); everything else stays small.
  const jsonSmall = express.json({ limit: '1mb' }), jsonLarge = express.json({ limit: '8mb' });
  app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/admin/notices' ? jsonLarge : jsonSmall)(req, res, next));
  app.use(cookieParser());
  app.use(loadUser);

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api', core, gate, member, admin, notices);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // Serve the built web app in production.
  const web = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(web)) {
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
