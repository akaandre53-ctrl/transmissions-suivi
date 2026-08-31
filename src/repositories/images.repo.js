import { query } from '../db/pool.js';

export async function insert({ ownerId, clientRef, fieldName, category, filename, mimeType, content }) {
  const { rows } = await query(
    `INSERT INTO images (owner_id, client_ref, field_name, category, filename, mime_type, byte_size, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, field_name, category, filename, mime_type, byte_size, created_at`,
    [ownerId, clientRef, fieldName, category, filename, mimeType, content.length, content]
  );
  return rows[0];
}

/** Métadonnées sans le contenu binaire — pour les listes et les vérifications. */
export async function findMetaByIds(ids, ownerId) {
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT id, field_name, category, filename, mime_type, byte_size, transmission_id
       FROM images
      WHERE id = ANY($1::uuid[]) AND owner_id = $2`,
    [ids, ownerId]
  );
  return rows;
}

export async function findByTransmission(transmissionId) {
  const { rows } = await query(
    `SELECT id, field_name, category, filename, mime_type, byte_size, content
       FROM images WHERE transmission_id = $1 ORDER BY created_at`,
    [transmissionId]
  );
  return rows;
}

export async function findOne(id) {
  const { rows } = await query(
    'SELECT id, transmission_id, mime_type, filename, content FROM images WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

/** Rattache les photos téléversées à la transmission une fois celle-ci créée. */
export async function attachToTransmission(ids, transmissionId, ownerId, client = null) {
  if (!ids.length) return 0;
  const run = client ? client.query.bind(client) : query;
  const { rowCount } = await run(
    `UPDATE images SET transmission_id = $2
      WHERE id = ANY($1::uuid[]) AND owner_id = $3 AND transmission_id IS NULL`,
    [ids, transmissionId, ownerId]
  );
  return rowCount;
}

export async function countForClientRef(clientRef, ownerId) {
  const { rows } = await query(
    'SELECT count(*)::int AS total FROM images WHERE client_ref = $1 AND owner_id = $2',
    [clientRef, ownerId]
  );
  return rows[0].total;
}

export async function remove(id, ownerId) {
  const { rowCount } = await query(
    'DELETE FROM images WHERE id = $1 AND owner_id = $2 AND transmission_id IS NULL',
    [id, ownerId]
  );
  return rowCount > 0;
}

/** Supprime les photos téléversées puis jamais validées. */
export async function purgeOrphans(olderThanHours = 48) {
  const { rowCount } = await query(
    `DELETE FROM images
      WHERE transmission_id IS NULL
        AND created_at < now() - ($1 || ' hours')::interval`,
    [String(olderThanHours)]
  );
  return rowCount;
}
