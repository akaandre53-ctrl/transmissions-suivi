import { query } from '../db/pool.js';

const PUBLIC_COLUMNS = 'id, email, full_name, role, is_active, created_at, last_login_at';

export async function findByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, password_hash, full_name, role, is_active
       FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [String(email || '').trim()]
  );
  return rows[0] || null;
}

export async function findById(id) {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function create({ email, passwordHash, fullName, role }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING ${PUBLIC_COLUMNS}`,
    [String(email).trim().toLowerCase(), passwordHash, String(fullName).trim(), role]
  );
  return rows[0];
}

export async function updatePassword(id, passwordHash) {
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
}

export async function touchLogin(id) {
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
}

export async function list() {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at`);
  return rows;
}

export async function setActive(id, isActive) {
  const { rows } = await query(
    `UPDATE users SET is_active = $2 WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [id, isActive]
  );
  return rows[0] || null;
}

export async function countAll() {
  const { rows } = await query('SELECT count(*)::int AS total FROM users');
  return rows[0].total;
}
