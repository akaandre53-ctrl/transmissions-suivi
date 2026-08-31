import { AppError } from './errors.js';

/** Enveloppe un handler async pour que ses rejets partent vers le middleware d'erreur. */
export const asyncHandler = handler => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/**
 * Middleware d'erreur unique. Il garantit deux choses :
 *  - la réponse est TOUJOURS du JSON, y compris pour les erreurs internes.
 *    Le navigateur peut donc appeler response.json() sans tomber sur du HTML ;
 *  - seuls les messages explicitement destinés à l'utilisateur sortent.
 */
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  // Corps JSON malformé ou trop volumineux, détecté par express.json().
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      ok: false,
      code: 'payload_too_large',
      error: 'Les données envoyées sont trop volumineuses. Réduisez le nombre de photos.'
    });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, code: 'invalid_json', error: 'Requête illisible.' });
  }

  if (error instanceof AppError) {
    return res.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message,
      ...(error.details ? { details: error.details } : {})
    });
  }

  console.error('[erreur]', req.method, req.originalUrl, '-', error?.stack || error);
  return res.status(500).json({
    ok: false,
    code: 'internal_error',
    error: 'Une erreur interne est survenue. Réessayez dans un instant.'
  });
}

/** Toute route /api inconnue répond en JSON, jamais en HTML. */
export function apiNotFound(req, res) {
  res.status(404).json({ ok: false, code: 'not_found', error: 'Ressource introuvable.' });
}

export function parseCookies(header = '') {
  const jar = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      jar[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      jar[name] = part.slice(index + 1).trim();
    }
  }
  return jar;
}

export function serializeCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  return parts.join('; ');
}

/**
 * Vérifie qu'un paramètre d'URL est bien un UUID avant qu'il n'atteigne une
 * requête SQL. Sans ce garde, `/api/uploads/nimporte-quoi` provoque une erreur
 * de cast Postgres, donc une 500, là où un 404 est la bonne réponse.
 */
export function requireUuidParam(name = 'id') {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return (req, res, next) => {
    if (UUID.test(req.params[name] || '')) return next();
    res.status(404).json({ ok: false, code: 'not_found', error: 'Ressource introuvable.' });
  };
}
