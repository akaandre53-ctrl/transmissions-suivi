import { isSheetsConfigured } from '../config.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { MAX_IMAGES } from '../domain/schema.js';
import { validateClientRef, validateImageIds, validateTransmission } from '../domain/validate.js';
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
 *   1. valider  — rien n'est écrit tant que la saisie n'est pas correcte ;
 *   2. écrire en base, de façon idempotente et transactionnelle avec le
 *      rattachement des photos ;
 *   3. recopier vers Sheets, sans jamais pouvoir faire échouer l'étape 2.
 *
 * Le PDF n'est plus produit ici. Il est rendu à la demande depuis la ligne
 * enregistrée, via getPdf(). L'ancien enchaînement « écrire dans Sheets puis
 * fabriquer le PDF » laissait une ligne orpheline dans la feuille dès que la
 * génération échouait, et l'aidant·e renvoyait le formulaire — d'où les doublons.
 */
export async function submitTransmission({ user, payload }) {
  const clientRef = validateClientRef(payload?.clientRef);
  const imageIds = validateImageIds(payload?.imageIds);
  const { values, errors } = validateTransmission(payload?.values);

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
      entryDate: values.date,
      personName: values.personName,
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

/**
 * Produit le PDF d'une transmission déjà enregistrée.
 * Rejouable autant de fois que nécessaire.
 */
export async function getPdf({ user, id }) {
  const transmission = await repo.findByIdWithAuthor(id);
  if (!transmission) throw notFound('Cette transmission n’existe pas.');
  assertCanRead(user, transmission);

  const images = await imagesRepo.findByTransmission(id);
  const buffer = await renderTransmissionPdf(transmission, images);
  return { buffer, filename: pdfFilename(transmission.data || {}) };
}

export async function getOne({ user, id }) {
  const transmission = await repo.findByIdWithAuthor(id);
  if (!transmission) throw notFound('Cette transmission n’existe pas.');
  assertCanRead(user, transmission);
  const photos = (await imagesRepo.findByTransmission(id)).map(image => ({
    id: image.id,
    category: image.category,
    filename: image.filename
  }));
  return { ...toPublic(transmission), photos };
}

export async function listForUser({ user, limit, before }) {
  // L'aidant·e voit ses propres transmissions ; la famille et l'admin voient tout.
  const authorId = user.role === 'aidant' ? user.id : null;
  const rows = await repo.list({ limit, before, authorId });
  return rows.map(toPublic);
}

function assertCanRead(user, transmission) {
  if (user.role === 'admin' || user.role === 'famille') return;
  if (transmission.author_id === user.id) return;
  throw forbidden('Vous ne pouvez consulter que vos propres transmissions.');
}

const toPublic = row => ({
  id: row.id,
  entryDate: row.entry_date instanceof Date
    ? row.entry_date.toISOString().slice(0, 10)
    : String(row.entry_date).slice(0, 10),
  personName: row.person_name,
  authorName: row.author_name,
  summary: row.summary,
  createdAt: row.created_at,
  sheetStatus: row.sheet_status,
  ...(row.data ? { values: row.data } : {})
});
