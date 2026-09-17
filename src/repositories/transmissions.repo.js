import { query } from '../db/pool.js';

// Quelques champs sont extraits du JSON pour la frise de l'historique, sans
// faire transiter la transmission entière pour chaque carte.
const LIST_COLUMNS = `
  t.id, t.client_ref, t.entry_date, t.person_name, t.beneficiary_id, t.summary,
  t.created_at, t.sheet_status, t.sheet_synced_at,
  t.data->>'period' AS period,
  t.data->>'generalState' AS general_state,
  t.data->>'hasEvent' AS has_event,
  t.data->>'attentionLevel' AS attention_level,
  (SELECT count(*)::int FROM images i WHERE i.transmission_id = t.id) AS photo_count,
  u.full_name AS author_name, u.id AS author_id`;

/**
 * Insertion idempotente : deux envois portant la même `client_ref` ne créent
 * qu'une ligne. Le second récupère la première, c'est ce qui empêche les
 * doublons quand le réseau lâche après l'écriture mais avant la réponse.
 *
 * @returns {{ row: object, created: boolean }}
 */
export async function insertIdempotent(
  { clientRef, authorId, beneficiaryId, entryDate, personName, data, summary, sheetStatus },
  client = null
) {
  // `client` est obligatoire quand l'appel a lieu dans une transaction : celle-ci
  // détient déjà une connexion, et le pool n'en compte qu'une en environnement
  // serverless. Repasser par le pool attendrait une connexion que la transaction
  // ne libérera qu'après cet appel, un interblocage jusqu'à expiration.
  const run = client ? client.query.bind(client) : query;

  const { rows } = await run(
    `INSERT INTO transmissions
       (client_ref, author_id, beneficiary_id, entry_date, person_name, data, summary, sheet_status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     ON CONFLICT (client_ref) DO NOTHING
     RETURNING *`,
    [clientRef, authorId, beneficiaryId, entryDate, personName, JSON.stringify(data), summary, sheetStatus]
  );
  if (rows[0]) return { row: rows[0], created: true };

  const existing = await run('SELECT * FROM transmissions WHERE client_ref = $1', [clientRef]);
  return { row: existing.rows[0], created: false };
}

export async function findById(id) {
  const { rows } = await query('SELECT * FROM transmissions WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function findByIdWithAuthor(id) {
  const { rows } = await query(
    `SELECT t.*, u.full_name AS author_name
       FROM transmissions t JOIN users u ON u.id = t.author_id
      WHERE t.id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Historique visible par un compte.
 *
 * Le filtre par rôle est appliqué EN SQL, jamais après coup en JavaScript :
 * c'est la seule façon de garantir qu'une ligne non autorisée ne quitte pas la
 * base, et que la pagination reste juste. Les règles sont celles de
 * domain/access.js.
 */
export async function listVisible(user, { limit = 30, before = null, beneficiaryId = null } = {}) {
  const params = [Math.min(Math.max(Number(limit) || 30, 1), 100)];
  const conditions = [];

  if (user.role === 'aidant') {
    params.push(user.id);
    conditions.push(`t.author_id = $${params.length}`);
  } else if (user.role === 'famille') {
    params.push(user.id);
    conditions.push(`t.beneficiary_id IN (
      SELECT ub.beneficiary_id FROM user_beneficiaries ub WHERE ub.user_id = $${params.length})`);
  } else if (user.role !== 'admin') {
    return [];
  }

  if (beneficiaryId) {
    params.push(beneficiaryId);
    conditions.push(`t.beneficiary_id = $${params.length}`);
  }
  if (before) {
    params.push(before);
    conditions.push(`t.created_at < $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ${LIST_COLUMNS}
       FROM transmissions t JOIN users u ON u.id = t.author_id
       ${where}
      ORDER BY t.created_at DESC
      LIMIT $1`,
    params
  );
  return rows;
}

export async function countPhotos(transmissionId) {
  const { rows } = await query(
    'SELECT count(*)::int AS total FROM images WHERE transmission_id = $1',
    [transmissionId]
  );
  return rows[0].total;
}

export async function markSheetSynced(id) {
  await query(
    `UPDATE transmissions
        SET sheet_status = 'synced', sheet_synced_at = now(), sheet_error = NULL, updated_at = now()
      WHERE id = $1`,
    [id]
  );
}

export async function markSheetFailed(id, message) {
  await query(
    `UPDATE transmissions
        SET sheet_status = CASE WHEN sheet_attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END,
            sheet_attempts = sheet_attempts + 1,
            sheet_error = $2,
            updated_at = now()
      WHERE id = $1`,
    [id, String(message || '').slice(0, 500), 5]
  );
}

/** File d'attente de la recopie vers Sheets. */
export async function findPendingSheetSync(limit = 20) {
  const { rows } = await query(
    `SELECT t.*, u.full_name AS author_name
       FROM transmissions t JOIN users u ON u.id = t.author_id
      WHERE t.sheet_status IN ('pending', 'failed') AND t.sheet_attempts < 5
      ORDER BY t.created_at
      LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function sheetSyncStats() {
  const { rows } = await query(
    `SELECT sheet_status AS status, count(*)::int AS total
       FROM transmissions GROUP BY sheet_status`
  );
  return Object.fromEntries(rows.map(row => [row.status, row.total]));
}
