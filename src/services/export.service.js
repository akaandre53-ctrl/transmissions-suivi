import { DATA_FIELDS } from '../domain/schema.js';

/**
 * Export CSV des transmissions d'une personne, destiné à être ouvert dans un
 * tableur pour en tirer des courbes (poids, tension, glycémie, humeur).
 *
 * Conventions françaises : séparateur point-virgule, virgule décimale, et un
 * BOM en tête. C'est ce qu'attend Excel en français ; sans cela, tout arrive
 * dans une seule colonne et les accents sont illisibles. Google Sheets et
 * LibreOffice reconnaissent ce format sans réglage.
 */

const SEPARATOR = ';';

// Le numéro du destinataire WhatsApp n'a rien à faire dans un export d'analyse,
// et les trois autres sont déjà en colonnes d'en-tête.
const SKIPPED = new Set(['date', 'personName', 'caregiverName', 'recipientPhone']);

const EXPORT_FIELDS = DATA_FIELDS.filter(field => !SKIPPED.has(field.name));

export const CSV_HEADER = [
  'Horodatage',
  'Date',
  'Personne accompagnée',
  'Saisi par',
  'Photos',
  ...EXPORT_FIELDS.map(field => (field.unit ? `${field.label} (${field.unit})` : field.label))
];

/**
 * Une valeur commençant par =, +, @, tabulation ou retour chariot est
 * interprétée comme une formule par Excel et Google Sheets. Le texte vient
 * d'une saisie libre : on le neutralise avec une apostrophe.
 */
const DANGEROUS_START = /^[=+@\t\r]/;

const escapeCsv = value => {
  const text = String(value ?? '');
  const guarded = DANGEROUS_START.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};

/** Les nombres partent avec une virgule décimale, sans guillemets. */
const formatNumber = value => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? String(number).replace('.', ',') : escapeCsv(text);
};

const isoDate = value => (value instanceof Date
  ? value.toISOString().slice(0, 10)
  : String(value ?? '').slice(0, 10));

/**
 * @param {Array} rows lignes de transmissions.repo.listForExport
 * @returns {string} contenu CSV, BOM compris
 */
export function buildTransmissionsCsv(rows) {
  const lines = [CSV_HEADER.map(escapeCsv).join(SEPARATOR)];

  for (const row of rows) {
    const values = row.data || {};
    const cells = [
      escapeCsv(new Date(row.created_at).toLocaleString('fr-FR')),
      escapeCsv(isoDate(row.entry_date)),
      escapeCsv(row.person_name),
      escapeCsv(row.author_name),
      String(row.photo_count ?? 0),
      ...EXPORT_FIELDS.map(field => (field.type === 'number'
        ? formatNumber(values[field.name])
        : escapeCsv(values[field.name])))
    ];
    lines.push(cells.join(SEPARATOR));
  }

  // Fin de ligne Windows : Excel s'en accommode partout, l'inverse n'est pas vrai.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvFilename(fullName, rows) {
  const person = String(fullName || 'personne')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const dates = rows.map(row => isoDate(row.entry_date)).filter(Boolean).sort();
  const span = dates.length ? `-${dates[0]}_${dates.at(-1)}` : '';
  return `transmissions-${person || 'personne'}${span}.csv`;
}
