import { badRequest } from '../lib/errors.js';
import { DATA_FIELDS, MAX_IMAGES, isFieldActive } from './schema.js';

const clean = value => String(value ?? '').trim();

const PHONE_PATTERN = /^\+\d{8,15}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Normalise un numéro saisi avec espaces, points ou tirets. */
export const normalizePhone = value => clean(value).replace(/[\s().-]/g, '');

/**
 * Valide et nettoie la charge utile d'une transmission.
 *
 * Règle centrale : un champ dont la condition d'affichage n'est pas remplie
 * voit sa valeur effacée, et son caractère obligatoire ignoré. C'est ce qui
 * empêche à la fois les données fantômes en base et les blocages sur un champ
 * requis mais invisible.
 *
 * Renvoie { values, errors }, `errors` est une liste { field, message }.
 */
export function validateTransmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Données de transmission invalides.');
  }

  const raw = {};
  for (const field of DATA_FIELDS) raw[field.name] = clean(input[field.name]);

  const values = {};
  const errors = [];

  for (const field of DATA_FIELDS) {
    if (!isFieldActive(field, raw)) {
      values[field.name] = '';
      continue;
    }

    let value = raw[field.name];

    if (field.type === 'select' && value && !field.options.includes(value)) {
      errors.push({ field: field.name, message: `« ${field.label} » : choix non reconnu.` });
      value = '';
    }

    if (field.type === 'number' && value !== '') {
      const number = Number(value.replace(',', '.'));
      if (!Number.isFinite(number)) {
        errors.push({ field: field.name, message: `« ${field.label} » doit être un nombre.` });
        value = '';
      } else if (field.min !== undefined && number < field.min) {
        errors.push({ field: field.name, message: `« ${field.label} » ne peut pas être inférieur à ${field.min}.` });
      } else if (field.max !== undefined && number > field.max) {
        errors.push({ field: field.name, message: `« ${field.label} » ne peut pas dépasser ${field.max}.` });
      } else {
        value = String(number);
      }
    }

    if (field.type === 'date' && value && !DATE_PATTERN.test(value)) {
      errors.push({ field: field.name, message: `« ${field.label} » : date invalide.` });
      value = '';
    }

    if (field.type === 'tel' && value) {
      value = normalizePhone(value);
      if (!PHONE_PATTERN.test(value)) {
        errors.push({
          field: field.name,
          message: 'Utilisez un numéro au format international, par exemple +2250700000000.'
        });
      }
    }

    if (field.required && !value) {
      errors.push({ field: field.name, message: `« ${field.label} » est obligatoire.` });
    }

    // Garde-fou contre un envoi anormalement long (copier-coller accidentel).
    const limit = field.type === 'textarea' ? 4000 : 500;
    if (value.length > limit) {
      errors.push({ field: field.name, message: `« ${field.label} » dépasse ${limit} caractères.` });
      value = value.slice(0, limit);
    }

    values[field.name] = value;
  }

  const entryDate = values.date || new Date().toISOString().slice(0, 10);
  const parsed = new Date(`${entryDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    errors.push({ field: 'date', message: 'Date du suivi invalide.' });
  } else {
    const inTwoDays = Date.now() + 2 * 24 * 60 * 60 * 1000;
    if (parsed.getTime() > inTwoDays) {
      errors.push({ field: 'date', message: 'La date du suivi ne peut pas être dans le futur.' });
    }
  }

  return { values, errors };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateImageIds(input) {
  const ids = Array.isArray(input) ? input.filter(id => typeof id === 'string') : [];
  const unique = [...new Set(ids)];
  // Le format est vérifié ici et pas seulement en base : sans cela, une chaîne
  // quelconque atteint le cast `::uuid[]` de Postgres et remonte en erreur 500.
  if (unique.some(id => !UUID.test(id))) {
    throw badRequest('Référence de photo invalide. Rechargez la page et réessayez.');
  }
  if (unique.length > MAX_IMAGES) {
    throw badRequest(`${MAX_IMAGES} photos maximum par transmission.`);
  }
  return unique;
}

export function validateClientRef(value) {
  const ref = clean(value);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(ref)) {
    throw badRequest('Référence de brouillon invalide.');
  }
  return ref;
}
