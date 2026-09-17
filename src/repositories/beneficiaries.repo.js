import { query, transaction } from '../db/pool.js';
import { isUuid } from '../domain/access.js';

const COLUMNS = 'b.id, b.full_name, b.is_active, b.created_at';

/** Identifiants des personnes rattachées à un compte. */
export async function linkedIds(userId) {
  const { rows } = await query(
    'SELECT beneficiary_id FROM user_beneficiaries WHERE user_id = $1',
    [userId]
  );
  return new Set(rows.map(row => row.beneficiary_id));
}

/**
 * Personnes visibles par un compte : toutes pour l'admin, les siennes pour
 * les autres. Seules les fiches actives sont proposées à la saisie.
 */
export async function listAccessible(user, { includeInactive = false } = {}) {
  const active = includeInactive ? '' : 'AND b.is_active';
  if (user.role === 'admin') {
    const { rows } = await query(
      `SELECT ${COLUMNS} FROM beneficiaries b WHERE true ${active} ORDER BY lower(b.full_name)`
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM beneficiaries b
       JOIN user_beneficiaries ub ON ub.beneficiary_id = b.id
      WHERE ub.user_id = $1 ${active}
      ORDER BY lower(b.full_name)`,
    [user.id]
  );
  return rows;
}

/** Fiche active pour laquelle ce compte a le droit de saisir, ou null. */
export async function findWritable(user, id) {
  if (!isUuid(id)) return null;
  if (user.role === 'admin') {
    const { rows } = await query(
      `SELECT ${COLUMNS} FROM beneficiaries b WHERE b.id = $1 AND b.is_active`,
      [id]
    );
    return rows[0] || null;
  }
  if (user.role !== 'aidant') return null;
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM beneficiaries b
       JOIN user_beneficiaries ub ON ub.beneficiary_id = b.id
      WHERE b.id = $1 AND ub.user_id = $2 AND b.is_active`,
    [id, user.id]
  );
  return rows[0] || null;
}

/** Vue d'administration : chaque fiche avec son nombre de transmissions et de comptes. */
export async function listWithStats() {
  const { rows } = await query(
    `SELECT ${COLUMNS},
            (SELECT count(*)::int FROM transmissions t WHERE t.beneficiary_id = b.id) AS transmissions,
            (SELECT count(*)::int FROM user_beneficiaries ub WHERE ub.beneficiary_id = b.id) AS accounts
       FROM beneficiaries b
      ORDER BY b.is_active DESC, lower(b.full_name)`
  );
  return rows;
}

export async function create(fullName) {
  const { rows } = await query(
    `INSERT INTO beneficiaries (full_name) VALUES ($1)
     RETURNING id, full_name, is_active, created_at`,
    [fullName]
  );
  return rows[0];
}

export async function findByName(fullName) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM beneficiaries b WHERE lower(btrim(b.full_name)) = lower(btrim($1))`,
    [fullName]
  );
  return rows[0] || null;
}

export async function update(id, { fullName, isActive }) {
  const { rows } = await query(
    `UPDATE beneficiaries
        SET full_name = COALESCE($2, full_name),
            is_active = COALESCE($3, is_active)
      WHERE id = $1
      RETURNING id, full_name, is_active, created_at`,
    [id, fullName ?? null, isActive ?? null]
  );
  return rows[0] || null;
}

/** Remplace l'ensemble des personnes rattachées à un compte. */
export async function setLinks(userId, beneficiaryIds) {
  const ids = [...new Set(beneficiaryIds.filter(isUuid))];
  // Toutes les requêtes passent par `client` : la transaction détient l'unique
  // connexion du pool en production (voir scripts/check-db.mjs).
  return transaction(async client => {
    await client.query('DELETE FROM user_beneficiaries WHERE user_id = $1', [userId]);
    if (ids.length) {
      await client.query(
        `INSERT INTO user_beneficiaries (user_id, beneficiary_id)
         SELECT $1, b.id FROM beneficiaries b WHERE b.id = ANY($2::uuid[])`,
        [userId, ids]
      );
    }
    const { rows } = await client.query(
      'SELECT beneficiary_id FROM user_beneficiaries WHERE user_id = $1',
      [userId]
    );
    return rows.map(row => row.beneficiary_id);
  });
}

/** Rattachements de tous les comptes, pour l'écran d'administration. */
export async function linksByUser() {
  const { rows } = await query('SELECT user_id, beneficiary_id FROM user_beneficiaries');
  const map = new Map();
  for (const { user_id: userId, beneficiary_id: beneficiaryId } of rows) {
    if (!map.has(userId)) map.set(userId, []);
    map.get(userId).push(beneficiaryId);
  }
  return map;
}
