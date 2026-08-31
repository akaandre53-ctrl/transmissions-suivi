import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { parseCookies, serializeCookie } from '../lib/http.js';

const hashToken = token => createHash('sha256').update(token).digest('hex');
const ttlSeconds = () => config.session.ttlDays * 24 * 60 * 60;

export async function createSession(userId, userAgent = '') {
  // Le jeton en clair n'existe que dans le cookie ; la base n'en garde que le hachage.
  const token = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval, $4)`,
    [hashToken(token), userId, String(ttlSeconds()), userAgent.slice(0, 300)]
  );
  return token;
}

export async function resolveSession(token) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.role, u.is_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      LIMIT 1`,
    [hashToken(token)]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  return user;
}

export async function destroySession(token) {
  if (!token) return;
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function destroyAllSessions(userId) {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function purgeExpiredSessions() {
  const { rowCount } = await query('DELETE FROM sessions WHERE expires_at < now()');
  return rowCount;
}

export const readSessionToken = req =>
  parseCookies(req.headers.cookie || '')[config.session.cookieName] || null;

export function setSessionCookie(res, token) {
  res.append('Set-Cookie', serializeCookie(config.session.cookieName, token, {
    maxAge: ttlSeconds(),
    secure: config.isProduction
  }));
}

export function clearSessionCookie(res) {
  res.append('Set-Cookie', serializeCookie(config.session.cookieName, '', {
    maxAge: 0,
    secure: config.isProduction
  }));
}
