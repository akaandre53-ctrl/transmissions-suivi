import { isSheetsConfigured } from '../config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { MAX_IMAGES } from '../domain/schema.js';
import { canReadImage, canReadTransmission, isUuid } from '../domain/access.js';
import { validateClientRef, validateImageIds, validateTransmission } from '../domain/validate.js';
import * as beneficiariesRepo from '../repositories/beneficiaries.repo.js';
import * as imagesRepo from '../repositories/images.repo.js';
import * as repo from '../repositories/transmissions.repo.js';
import { transaction } from '../db/pool.js';
import { buildSummary, buildWhatsappGreeting } from './message.service.js';
import { renderTransmissionPdf, pdfFilename } from './pdf.service.js';
import { mirrorToSheet } from './sheets.service.js';

/**
 * Enregistre une transmission.
 *
 * Ordre des opérations, et pourquoi il compte :
 *   1. vérifier que le compte a le droit de saisir pour cette personne ;
 *   2. valider : rien n'est écrit tant que la saisie n'est pas correcte ;
 *   3. écrire en base, de façon idempotente et transactionnelle avec le
 *      rattachement des photos ;
 *   4. recopier vers Sheets, sans jamais pouvoir faire échouer l'étape 3.
 *
 * Le champ personName arrive du formulaire sous la forme de l'identifiant de
 * la fiche choisie dans la liste. Il est remplacé ici par le nom de la
 * personne avant validation : tout ce qui suit (PDF, résumé, feuille) continue
 * de lire un nom, et un nom tapé à la main ne peut plus être accepté.
 *
 * Le PDF n'est pas produit ici. Il est rendu à la demande depuis la ligne
 * enregistrée, via getPdf().
 */
export async function submitTransmission({ user, payload }) {
  const clientRef = validateClientRef(payload?.clientRef);
  const imageIds = validateImageIds(payload?.imageIds);
  const input = payload?.values;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Données de transmission invalides.');
  }

  const beneficiaryRef = String(input.personName ?? '').trim();
  let beneficiary = null;
  if (beneficiaryRef) {
    beneficiary = await beneficiariesRepo.findWritable(user, beneficiaryRef);
    if (!beneficiary) {
      throw badRequest('Cette personne ne fait pas partie de celles qui vous sont confiées.', [{
        field: 'personName',
        message: isUuid(beneficiaryRef)
          ? 'Vous n’avez pas accès à cette personne. Demandez à l’administrateur de vous la rattacher.'
          : 'Choisissez la personne accompagnée dans la liste.'
      }]);
    }
  }

  const { values, errors } = validateTransmission({ ...input, personName: beneficiary?.full_name ?? '' });
  if (errors.length) {
    throw badRequest('Certains champs doivent être corrigés avant l’enregistrement.', errors);
  }

  const owned = await imagesRepo.findMetaByIds(imageIds, user.id);
  if (owned.length !== imageIds.length) {
    throw badRequest('Une ou plusieurs photos ne sont plus disponibles. Ajoutez-les à nouveau.');
  }
  if (owned.length > MAX_IMAGES) {
    throw badRequest(`${MAX_IMAGES} photos maximum par transmission.`);
  }

  const summary = buildSummary(values, { photoCount: owned.length });

  // Toutes les requêtes de ce bloc passent par `client`, la connexion que la
  // transaction a réservée. En repasser une seule par le pool provoquerait un
  // interblocage là où le pool est limité à une connexion, c'est-à-dire en
  // production, et nulle part ailleurs.
  const { row, created } = await transaction(async client => {
    const result = await repo.insertIdempotent({
      clientRef,
      authorId: user.id,
      beneficiaryId: beneficiary.id,
      entryDate: values.date,
      personName: beneficiary.full_name,
      data: values,
      summary,
      sheetStatus: isSheetsConfigured() ? 'pending' : 'skipped'
    }, client);
    if (result.created && imageIds.length) {
      await imagesRepo.attachToTransmission(imageIds, result.row.id, user.id, client);
    }
    return result;
  });

  // Le renvoi d'un formulaire déjà enregistré renvoie la même transmission,
  // sans créer de doublon ni relancer la recopie.
  if (!created) {
    return { transmission: row, created: false, sheet: { status: row.sheet_status } };
  }

  const sheet = await mirrorToSheet({ ...row, author_name: user.full_name }, owned.length);

  return {
    transmission: { ...row, sheet_status: sheet.status },
    created: true,
    sheet,
    greeting: buildWhatsappGreeting(values)
  };
}

/** Charge une transmission et vérifie que le compte peut la lire. */
async function loadReadable(user, id) {
  const transmission = await repo.findByIdWithAuthor(id);
  // Même réponse pour « n'existe pas » et « pas autorisé » : un compte famille
  // ne doit pas pouvoir tester quels identifiants existent chez les autres.
  if (!transmission) throw notFound('Cette transmission n’existe pas.');
  const linked = user.role === 'famille' ? await beneficiariesRepo.linkedIds(user.id) : new Set();
  if (!canReadTransmission(user, transmission, linked)) {
    throw notFound('Cette transmission n’existe pas.');
  }
  return transmission;
}

/** Produit le PDF d'une transmission déjà enregistrée. Rejouable à volonté. */
export async function getPdf({ user, id }) {
  const transmission = await loadReadable(user, id);
  const images = await imagesRepo.findByTransmission(id);
  const buffer = await renderTransmissionPdf(transmission, images);
  return { buffer, filename: pdfFilename(transmission.data || {}) };
}

export async function getOne({ user, id }) {
  const transmission = await loadReadable(user, id);
  const photos = (await imagesRepo.findByTransmission(id)).map(image => ({
    id: image.id,
    category: image.category,
    filename: image.filename
  }));
  return { ...toPublic(transmission), photos };
}

export async function listForUser({ user, limit, before, beneficiaryId }) {
  if (beneficiaryId && !isUuid(beneficiaryId)) {
    throw badRequest('Filtre de personne invalide.');
  }
  const rows = await repo.listVisible(user, { limit, before, beneficiaryId: beneficiaryId || null });
  return rows.map(toPublic);
}

/**
 * Photo enregistrée. Avant ce contrôle, n'importe quel compte connecté pouvait
 * lire n'importe quelle photo dont il connaissait l'identifiant, y compris
 * celles d'une autre famille.
 */
export async function getImage({ user, id }) {
  const image = await imagesRepo.findOne(id);
  if (!image) throw notFound('Photo introuvable.');
  const transmission = image.transmission_id
    ? await repo.findById(image.transmission_id)
    : null;
  const linked = user.role === 'famille' ? await beneficiariesRepo.linkedIds(user.id) : new Set();
  if (!canReadImage(user, image, transmission, linked)) throw notFound('Photo introuvable.');
  return image;
}

const toPublic = row => ({
  id: row.id,
  entryDate: row.entry_date instanceof Date
    ? row.entry_date.toISOString().slice(0, 10)
    : String(row.entry_date).slice(0, 10),
  personName: row.person_name,
  beneficiaryId: row.beneficiary_id,
  authorName: row.author_name,
  summary: row.summary,
  createdAt: row.created_at,
  sheetStatus: row.sheet_status,
  period: row.period ?? row.data?.period ?? null,
  generalState: row.general_state ?? row.data?.generalState ?? null,
  hasEvent: row.has_event ?? row.data?.hasEvent ?? null,
  attentionLevel: row.attention_level ?? row.data?.attentionLevel ?? null,
  photoCount: row.photo_count ?? null,
  ...(row.data ? { values: row.data } : {})
});
