import { query } from '../db/pool.js';
import { tooManyRequests } from './errors.js';
import { asyncHandler } from './http.js';

/**
 * Limitation de débit adossée à Postgres.
 *
 * L'ancienne implémentation utilisait une Map en mémoire : sur Vercel chaque
 * requête peut atterrir sur une instance neuve, donc le compteur repartait de
 * zéro et ne protégeait rien. En base, le compteur est partagé par toutes les
 * instances, et les fenêtres périmées sont purgées au passage.
 */
export function rateLimit({ name, limit, windowSeconds, keyFn }) {
  return asyncHandler(async (req, _res, next) => {
    const key = keyFn ? keyFn(req) : clientAddress(req);
    const bucket = `${name}:${key}`;

    const { rows } = await query(
      `INSERT INTO rate_limits (bucket, window_start, hits)
       VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
       ON CONFLICT (bucket, window_start)
       DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits, window_start`,
      [bucket, windowSeconds]
    );

    const { hits, window_start: windowStart } = rows[0];

    // Nettoyage opportuniste, sans tâche planifiée dédiée.
    if (hits === 1 && Math.random() < 0.02) {
      query('DELETE FROM rate_limits WHERE window_start < now() - interval \'1 day\'').catch(() => {});
    }

    if (hits > limit) {
      const retryAfter = Math.max(
        1,
        Math.ceil((new Date(windowStart).getTime() + windowSeconds * 1000 - Date.now()) / 1000)
      );
      const minutes = Math.ceil(retryAfter / 60);
      return next(tooManyRequests(
        `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`
      ));
    }
    next();
  });
}

export function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'inconnu';
}
