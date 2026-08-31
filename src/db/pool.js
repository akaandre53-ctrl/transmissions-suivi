import pg from 'pg';
import { config } from '../config.js';

// pg renvoie les NUMERIC en chaîne par défaut pour préserver la précision.
// Nos seules colonnes numériques sont des compteurs : on les veut en Number.
pg.types.setTypeParser(pg.types.builtins.INT8, value => Number.parseInt(value, 10));

let pool = null;

export function getPool() {
  if (pool) return pool;
  if (!config.database.url) {
    throw new Error('DATABASE_URL est absent. Renseignez-le dans .env avant de démarrer.');
  }
  pool = new pg.Pool({
    connectionString: config.database.url,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    max: config.database.maxConnections,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000
  });
  // Sans ce gestionnaire, une coupure réseau côté Postgres fait tomber le process.
  pool.on('error', error => console.error('[db] client inactif en erreur :', error.message));
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

/** Exécute une suite de requêtes dans une transaction, avec ROLLBACK automatique. */
export async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
