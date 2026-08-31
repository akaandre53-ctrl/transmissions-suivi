import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getPool, closePool } from './pool.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Applique les fichiers .sql de `migrations/` dans l'ordre alphabétique.
 * Chaque fichier tourne dans sa propre transaction et n'est appliqué qu'une fois.
 */
export async function runMigrations({ log = console.log } = {}) {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter(name => name.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map(row => row.name));
  const pending = files.filter(name => !applied.has(name));

  if (!pending.length) {
    log('Base à jour, aucune migration à appliquer.');
    return [];
  }

  for (const name of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      log(`Migration appliquée : ${name}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${name} en échec : ${error.message}`, { cause: error });
    } finally {
      client.release();
    }
  }
  return pending;
}

// Permet `npm run migrate`. pathToFileURL gère les chemins Windows (D:\…).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}
