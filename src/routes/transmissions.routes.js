import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler, requireUuidParam } from '../lib/http.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as service from '../services/transmissions.service.js';

export const transmissionsRouter = Router();

transmissionsRouter.post(
  '/',
  requireRole('aidant'),
  rateLimit({ name: 'submit', limit: 40, windowSeconds: 60 * 60, keyFn: req => req.user.id }),
  asyncHandler(async (req, res) => {
    const result = await service.submitTransmission({ user: req.user, payload: req.body });

    res.status(result.created ? 201 : 200).json({
      ok: true,
      alreadySaved: !result.created,
      id: result.transmission.id,
      pdfUrl: `/api/transmissions/${result.transmission.id}/pdf`,
      greeting: result.greeting,
      // Le statut de la feuille est informatif : l'enregistrement est acquis
      // quoi qu'il arrive côté Google.
      sheet: { status: result.transmission.sheet_status }
    });
  })
);

transmissionsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const items = await service.listForUser({
    user: req.user,
    limit: Number(req.query.limit) || 30,
    before: req.query.before || null
  });
  res.json({ ok: true, items });
}));

transmissionsRouter.get('/:id', requireUuidParam(), requireAuth, asyncHandler(async (req, res) => {
  res.json({ ok: true, transmission: await service.getOne({ user: req.user, id: req.params.id }) });
}));

transmissionsRouter.get('/:id/pdf', requireUuidParam(), requireAuth, asyncHandler(async (req, res) => {
  const { buffer, filename } = await service.getPdf({ user: req.user, id: req.params.id });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));
