/**
 * Erreur destinée à l'utilisateur : son message est affiché tel quel.
 * Toute autre erreur est journalisée côté serveur et remplacée par un message
 * générique, pour ne jamais divulguer d'identifiant de feuille, d'e-mail de
 * compte de service ou de trace technique.
 */
export class AppError extends Error {
  constructor(message, { status = 400, code = 'invalid_request', details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message, details) =>
  new AppError(message, { status: 400, code: 'invalid_request', details });

export const unauthorized = (message = 'Vous devez vous connecter pour continuer.') =>
  new AppError(message, { status: 401, code: 'unauthorized' });

export const forbidden = (message = 'Vous n’avez pas accès à cette action.') =>
  new AppError(message, { status: 403, code: 'forbidden' });

export const notFound = (message = 'Élément introuvable.') =>
  new AppError(message, { status: 404, code: 'not_found' });

export const tooManyRequests = message =>
  new AppError(message, { status: 429, code: 'rate_limited' });

export const payloadTooLarge = message =>
  new AppError(message, { status: 413, code: 'payload_too_large' });
