import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUser, requireSameOrigin } from './auth/middleware.js';
import { config } from './config.js';
import { MAX_IMAGES, MAX_IMAGE_BYTES, SECTIONS } from './domain/schema.js';
import { apiNotFound, errorHandler } from './lib/http.js';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { transmissionsRouter } from './routes/transmissions.routes.js';
import { uploadsRouter } from './routes/uploads.routes.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();

  // Vercel place un proxy devant l'application : sans cela, toutes les requêtes
  // partagent la même adresse et la limitation de débit devient globale.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // 3 Mo : une photo compressée par requête, avec de la marge. On reste
  // largement sous la limite de 4,5 Mo des fonctions serverless.
  app.use('/api', express.json({ limit: '3mb' }));
  app.use('/api', attachUser, requireSameOrigin);

  app.get('/api/schema', (_req, res) => {
    res.json({ ok: true, sections: SECTIONS, maxImages: MAX_IMAGES, maxImageBytes: MAX_IMAGE_BYTES });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/transmissions', transmissionsRouter);
  app.use('/api/admin', adminRouter);

  // Toute route /api inconnue répond en JSON. Sans cela, le navigateur recevait
  // la page HTML de secours et échouait sur response.json().
  app.use('/api', apiNotFound);

  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    maxAge: config.isProduction ? '1h' : 0
  }));

  app.use(errorHandler);
  return app;
}
