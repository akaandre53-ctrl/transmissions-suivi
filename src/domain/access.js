/**
 * Règles d'accès aux transmissions.
 *
 * Elles tiennent en trois lignes, et chacune protège des données de santé :
 *   - l'admin voit et saisit tout ;
 *   - l'aidante voit ce qu'elle a saisi, et ne saisit que pour les personnes
 *     qui lui sont confiées ;
 *   - la famille voit uniquement les personnes qui lui sont rattachées, et ne
 *     saisit jamais.
 *
 * Ces fonctions sont pures : elles reçoivent l'ensemble des personnes
 * rattachées au compte au lieu d'interroger la base, ce qui permet de les
 * tester hors ligne. Les listes, elles, filtrent directement en SQL (voir
 * transmissions.repo.js) : filtrer en JavaScript après coup fausserait la
 * pagination et ferait transiter des lignes qui n'ont pas à sortir de la base.
 */

export const ROLES = Object.freeze(['admin', 'aidant', 'famille']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = value => typeof value === 'string' && UUID.test(value);

/**
 * @param {{ id: string, role: string }} user
 * @param {{ author_id: string, beneficiary_id: string|null }} transmission
 * @param {Set<string>} linkedIds personnes rattachées au compte
 */
export function canReadTransmission(user, transmission, linkedIds = new Set()) {
  if (!user || !transmission) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'aidant') return transmission.author_id === user.id;
  if (user.role === 'famille') {
    return Boolean(transmission.beneficiary_id) && linkedIds.has(transmission.beneficiary_id);
  }
  return false;
}

/** Peut-on enregistrer une transmission pour cette personne ? */
export function canWriteFor(user, beneficiaryId, linkedIds = new Set()) {
  if (!user || !isUuid(beneficiaryId)) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'aidant') return linkedIds.has(beneficiaryId);
  return false;
}

/**
 * Une photo pas encore rattachée n'appartient qu'à la personne qui l'a
 * envoyée. Une fois rattachée, elle suit la règle de sa transmission.
 */
export function canReadImage(user, image, transmission, linkedIds = new Set()) {
  if (!user || !image) return false;
  if (!image.transmission_id) return user.role === 'admin' || image.owner_id === user.id;
  return canReadTransmission(user, transmission, linkedIds);
}
