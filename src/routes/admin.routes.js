import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { hashPassword } from '../auth/password.js';
import { requireRole } from '../auth/middleware.js';
import { purgeExpiredSessions } from '../auth/session.js';
import { config, isSheetsConfigured } from '../config.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { asyncHandler, requireUuidParam } from '../lib/http.js';
import { isUuid } from '../domain/access.js';
import * as beneficiaries from '../repositories/beneficiaries.repo.js';
import * as images from '../repositories/images.repo.js';
import * as repo from '../repositories/transmissions.repo.js';
import * as users from '../repositories/users.repo.js';
import { retryPending } from '../services/sheets.service.js';

export const adminRouter = Router();

const ROLES = new Set(['admin', 'aidant', 'famille']);

adminRouter.get('/users', requireRole('admin'), asyncHandler(async (_req, res) => {
  const [list, links] = await Promise.all([users.list(), beneficiaries.linksByUser()]);
  res.json({
    ok: true,
    users: list.map(user => ({ ...user, beneficiary_ids: links.get(user.id) || [] }))
  });
}));

/* ------------------------------------------------- personnes accompagnées */

adminRouter.get('/beneficiaries', requireRole('admin'), asyncHandler(async (_req, res) => {
  res.json({ ok: true, beneficiaries: await beneficiaries.listWithStats() });
}));

adminRouter.post('/beneficiaries', requireRole('admin'), asyncHandler(async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim().replace(/\s+/g, ' ');
  if (fullName.length < 2) throw badRequest('Renseignez le nom de la personne accompagnée.');
  if (fullName.length > 120) throw badRequest('Ce nom est trop long.');
  if (await beneficiaries.findByName(fullName)) {
    throw badRequest('Une fiche existe déjà à ce nom.');
  }
  res.status(201).json({ ok: true, beneficiary: await beneficiaries.create(fullName) });
}));

adminRouter.patch('/beneficiaries/:id', requireUuidParam(), requireRole('admin'), asyncHandler(async (req, res) => {
  const patch = {};
  if (typeof req.body?.isActive === 'boolean') patch.isActive = req.body.isActive;
  if (typeof req.body?.fullName === 'string') {
    const fullName = req.body.fullName.trim().replace(/\s+/g, ' ');
    if (fullName.length < 2) throw badRequest('Renseignez le nom de la personne accompagnée.');
    const existing = await beneficiaries.findByName(fullName);
    if (existing && existing.id !== req.params.id) throw badRequest('Une fiche existe déjà à ce nom.');
    patch.fullName = fullName;
  }
  const updated = await beneficiaries.update(req.params.id, patch);
  if (!updated) throw notFound('Fiche introuvable.');
  res.json({ ok: true, beneficiary: updated });
}));

/**
 * Remplace les personnes rattachées à un compte. C'est l'unique moyen pour un
 * compte famille de voir des transmissions : sans rattachement, il ne voit rien.
 */
adminRouter.put('/users/:id/beneficiaries', requireUuidParam(), requireRole('admin'), asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.beneficiaryIds) ? req.body.beneficiaryIds : null;
  if (!ids) throw badRequest('Liste de personnes attendue.');
  if (ids.some(id => !isUuid(id))) throw badRequest('Identifiant de personne invalide.');
  if (!(await users.findById(req.params.id))) throw notFound('Compte introuvable.');
  res.json({ ok: true, beneficiaryIds: await beneficiaries.setLinks(req.params.id, ids) });
}));

adminRouter.post('/users', requireRole('admin'), asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const fullName = String(req.body?.fullName || '').trim();
  const role = String(req.body?.role || '').trim();
  const password = String(req.body?.password || '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('Adresse e-mail invalide.');
  if (fullName.length < 2) throw badRequest('Renseignez le nom complet.');
  if (!ROLES.has(role)) throw badRequest('Rôle inconnu.');
  if (password.length < 10) throw badRequest('Le mot de passe doit contenir au moins 10 caractères.');

  if (await users.findByEmail(email)) throw badRequest('Un compte existe déjà avec cet e-mail.');

  const created = await users.create({
    email, fullName, role, passwordHash: await hashPassword(password)
  });
  res.status(201).json({ ok: true, user: created });
}));

adminRouter.patch('/users/:id', requireUuidParam(), requireRole('admin'), asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id && req.body?.isActive === false) {
    throw badRequest('Vous ne pouvez pas désactiver votre propre compte.');
  }
  const updated = await users.setActive(req.params.id, Boolean(req.body?.isActive));
  if (!updated) throw notFound('Compte introuvable.');
  res.json({ ok: true, user: updated });
}));

adminRouter.get('/health', requireRole('admin', 'famille'), asyncHandler(async (_req, res) => {
  res.json({
    ok: true,
    sheets: { configured: isSheetsConfigured(), stats: await repo.sheetSyncStats() }
  });
}));

adminRouter.post('/sheets/retry', requireRole('admin'), asyncHandler(async (_req, res) => {
  res.json({ ok: true, ...(await retryPending(30)) });
}));

/**
 * Entretien planifié : reprise de la file Sheets, purge des sessions expirées
 * et des photos jamais validées. Protégée par CRON_SECRET plutôt que par une
 * session, pour être appelable par un planificateur.
 */
adminRouter.all('/maintenance', asyncHandler(async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) throw notFound('Méthode non supportée.');
  const provided = String(req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const expected = config.cronSecret;
  if (!expected) throw forbidden('CRON_SECRET n’est pas configuré.');

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw forbidden('Jeton de maintenance invalide.');
  }

  res.json({
    ok: true,
    sheets: await retryPending(50),
    sessionsPurged: await purgeExpiredSessions(),
    orphanImagesPurged: await images.purgeOrphans(48)
  });
}));
