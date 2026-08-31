import { SECTIONS, isFieldActive } from '../domain/schema.js';

const clean = value => String(value ?? '').trim();

const formatValue = (field, value) => {
  const text = clean(value);
  if (!text) return '';
  return field.unit ? `${text} ${field.unit}` : text;
};

/**
 * Construit le résumé lisible, dérivé du schéma.
 *
 * Les sections vides sont omises : sur WhatsApp, une liste de « Non renseigné »
 * noie l'information utile. La section « Partage » est exclue — le numéro du
 * destinataire n'a pas à figurer dans le message qu'il reçoit.
 */
export function buildSummary(values, { photoCount = 0 } = {}) {
  const blocks = [];

  const dateLabel = clean(values.date) || new Date().toISOString().slice(0, 10);
  const header = [`Transmission du ${formatDateFr(dateLabel)}`];
  blocks.push(header.join('\n'));

  for (const section of SECTIONS) {
    if (section.id === 'share') continue;

    const lines = [];
    for (const field of section.fields) {
      if (field.type === 'photo') continue;
      if (!isFieldActive(field, values)) continue;
      if (section.id === 'general' && field.name === 'date') continue;
      const value = formatValue(field, values[field.name]);
      if (value) lines.push(`${field.label} : ${value}`);
    }
    if (lines.length) blocks.push([section.title, ...lines].join('\n'));
  }

  if (photoCount > 0) {
    blocks.push(`Photos jointes : ${photoCount}`);
  }

  return blocks.join('\n\n');
}

export function formatDateFr(isoDate) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}

/** Message d'accompagnement envoyé dans WhatsApp, à côté du PDF. */
export function buildWhatsappGreeting(values) {
  const person = clean(values.personName) || 'la personne accompagnée';
  const date = formatDateFr(clean(values.date) || new Date().toISOString().slice(0, 10));
  return `Bonjour, veuillez trouver ci-joint la transmission quotidienne concernant ${person} pour la journée du ${date}. Bonne réception.`;
}
