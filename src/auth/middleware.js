import { forbidden, unauthorized } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { readSessionToken, resolveSession } from './session.js';

/** Attache req.user si une session valide est présente. N'échoue jamais. */
export const attachUser = asyncHandler(async (req, _res, next) => {
  const token = readSessionToken(req);
  req.sessionToken = token;
  req.user = token ? await resolveSession(token) : null;
  next();
});

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** requireRole('aidant', 'admin') — l'administrateur a toujours accès. */
export function requireRole(...roles) {
  const allowed = new Set([...roles, 'admin']);
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.has(req.user.role)) {
      return next(forbidden('Votre compte ne permet pas cette action.'));
    }
    next();
  };
}

/**
 * Défense CSRF. Le cookie de session est en SameSite=Lax, ce qui bloque déjà
 * les envois croisés ; on exige en plus un en-tête que seul du JavaScript
 * de même origine peut poser, ce qu'un formulaire HTML distant ne peut pas faire.
 */
export function requireSameOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'transmission-app') {
    return next(forbidden('Requête rejetée : origine non reconnue.'));
  }
  next();
}
