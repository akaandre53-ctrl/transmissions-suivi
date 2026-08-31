import { Router } from 'express';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  clearSessionCookie, createSession, destroyAllSessions, destroySession, setSessionCookie
} from '../auth/session.js';
import { requireAuth } from '../auth/middleware.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { rateLimit, clientAddress } from '../lib/rateLimit.js';
import * as users from '../repositories/users.repo.js';

export const authRouter = Router();

const publicUser = user => ({
  id: user.id,
  email: user.email,
  fullName: user.full_name,
  role: user.role
});

// Limite adossée à l'adresse ET à l'e-mail visé : une adresse partagée ne
// bloque pas tout le foyer, et un e-mail ciblé reste protégé.
const loginLimiter = rateLimit({
  name: 'login',
  limit: 10,
  windowSeconds: 15 * 60,
  keyFn: req => `${clientAddress(req)}|${String(req.body?.email || '').toLowerCase().slice(0, 80)}`
});

authRouter.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!email || !password) throw badRequest('Renseignez votre e-mail et votre mot de passe.');

  const user = await users.findByEmail(email);
  // Message identique dans tous les cas : on ne révèle pas quels comptes existent.
  const invalid = unauthorized('E-mail ou mot de passe incorrect.');
  if (!user || !user.is_active) {
    // Coût constant : on hache quand même, pour ne pas trahir l'absence de compte
    // par un temps de réponse plus court.
    await verifyPassword(password, 'scrypt$65536$8$1$AAAA$AAAA');
    throw invalid;
  }
  if (!(await verifyPassword(password, user.password_hash))) throw invalid;

  const token = await createSession(user.id, req.get('User-Agent') || '');
  setSessionCookie(res, token);
  await users.touchLogin(user.id);
  res.json({ ok: true, user: publicUser(user) });
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  await destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, code: 'unauthorized', user: null });
  res.json({ ok: true, user: publicUser(req.user) });
});

authRouter.post('/password', requireAuth, asyncHandler(async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 10) throw badRequest('Le nouveau mot de passe doit contenir au moins 10 caractères.');

  const stored = await users.findByEmail(req.user.email);
  if (!stored || !(await verifyPassword(current, stored.password_hash))) {
    throw badRequest('Le mot de passe actuel est incorrect.');
  }

  await users.updatePassword(req.user.id, await hashPassword(next));
  // Toutes les autres sessions tombent : un appareil perdu perd son accès.
  await destroyAllSessions(req.user.id);
  const token = await createSession(req.user.id, req.get('User-Agent') || '');
  setSessionCookie(res, token);
  res.json({ ok: true });
}));
