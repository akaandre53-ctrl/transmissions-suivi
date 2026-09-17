import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/http.js';
import * as beneficiaries from '../repositories/beneficiaries.repo.js';

export const beneficiariesRouter = Router();

/**
 * Personnes que le compte connecté peut voir : alimente la liste du
 * formulaire et les filtres de l'historique.
 */
beneficiariesRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const rows = await beneficiaries.listAccessible(req.user);
  res.json({
    ok: true,
    beneficiaries: rows.map(row => ({ id: row.id, fullName: row.full_name }))
  });
}));
