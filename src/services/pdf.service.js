import PDFDocument from 'pdfkit';
import { SECTIONS, isFieldActive } from '../domain/schema.js';
import { formatDateFr } from './message.service.js';

const INK = '#12312B';
const MUTED = '#4B5F5A';
const BRAND = '#0F6B57';
const RULE = '#CBDDD7';

const clean = value => String(value ?? '').trim();

/**
 * Rend la transmission en PDF.
 *
 * Contrairement à l'implémentation précédente, ce rendu est découplé de
 * l'enregistrement : il lit une transmission déjà persistée et peut donc être
 * rejoué autant de fois que nécessaire. Un échec ici n'a plus aucun effet sur
 * les données.
 *
 * @param {object} transmission  ligne `transmissions` (data, summary, entry_date…)
 * @param {Array}  images        [{ category, mime_type, content: Buffer }]
 * @param {object} options       { compress } — compress:false sert aux tests,
 *                               qui doivent pouvoir relire le flux de texte.
 */
export function renderTransmissionPdf(transmission, images = [], { compress = true } = {}) {
  return new Promise((resolve, reject) => {
    const values = transmission.data || {};
    const document = new PDFDocument({
      margin: 46,
      size: 'A4',
      compress,
      info: {
        Title: `Transmission du ${clean(values.date) || transmission.entry_date}`,
        Author: clean(values.caregiverName) || 'Accompagnant(e)',
        Subject: `Suivi quotidien — ${clean(values.personName) || ''}`.trim()
      }
    });

    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    try {
      drawHeader(document, values);
      drawSections(document, values);
      drawFooter(document, transmission);
      drawImages(document, images);
      document.end();
    } catch (error) {
      // Sans ce filet, une image corrompue laisse la promesse en suspens.
      reject(error);
    }
  });
}

function drawHeader(document, values) {
  const date = clean(values.date);
  document.font('Helvetica-Bold').fontSize(11).fillColor(BRAND)
    .text('SUIVI QUOTIDIEN', { characterSpacing: 1.6 });
  document.moveDown(0.3);
  document.font('Helvetica-Bold').fontSize(21).fillColor(INK)
    .text(clean(values.personName) || 'Transmission du jour');
  document.moveDown(0.25);

  const meta = [
    date ? formatDateFr(date) : null,
    clean(values.period),
    clean(values.caregiverName) ? `Accompagnant(e) : ${clean(values.caregiverName)}` : null
  ].filter(Boolean).join('  ·  ');

  document.font('Helvetica').fontSize(10).fillColor(MUTED).text(meta);
  document.moveDown(0.7);
  rule(document);
}

function drawSections(document, values) {
  for (const section of SECTIONS) {
    if (section.id === 'share') continue;

    const lines = [];
    for (const field of section.fields) {
      if (field.type === 'photo') continue;
      if (!isFieldActive(field, values)) continue;
      if (section.id === 'general' && ['date', 'personName', 'caregiverName', 'period'].includes(field.name)) continue;
      const value = clean(values[field.name]);
      if (!value) continue;
      lines.push([field.label, field.unit ? `${value} ${field.unit}` : value]);
    }
    if (!lines.length) continue;

    // Réserve la place du titre + une ligne : évite un titre orphelin en bas de page.
    if (document.y > document.page.height - document.page.margins.bottom - 70) {
      document.addPage();
    }

    document.moveDown(0.9);
    document.font('Helvetica-Bold').fontSize(12).fillColor(BRAND).text(section.title);
    document.moveDown(0.35);

    for (const [label, value] of lines) {
      const startY = document.y;
      const labelWidth = 168;
      const usable = document.page.width - document.page.margins.left - document.page.margins.right;

      document.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTED)
        .text(label, document.page.margins.left, startY, { width: labelWidth - 10 });
      const afterLabel = document.y;

      document.font('Helvetica').fontSize(10).fillColor(INK)
        .text(value, document.page.margins.left + labelWidth, startY, { width: usable - labelWidth });

      document.y = Math.max(afterLabel, document.y) + 4;
      document.x = document.page.margins.left;
    }
  }
}

function drawFooter(document, transmission) {
  document.moveDown(1);
  rule(document);
  document.moveDown(0.4);
  const stamp = new Date(transmission.created_at || Date.now())
    .toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  document.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(`Enregistré le ${stamp}  ·  Référence ${String(transmission.id).slice(0, 8)}`);
}

function drawImages(document, images) {
  const usable = document.page.width - document.page.margins.left - document.page.margins.right;
  for (const image of images) {
    if (!image?.content?.length) continue;
    try {
      document.addPage();
      document.font('Helvetica-Bold').fontSize(12).fillColor(BRAND)
        .text(clean(image.category) || 'Photo de la journée');
      document.moveDown(0.6);
      document.image(image.content, {
        fit: [usable, document.page.height - document.y - document.page.margins.bottom - 10],
        align: 'center'
      });
    } catch (error) {
      // Une photo illisible ne doit pas priver la famille du reste du document.
      console.error('[pdf] photo ignorée :', error.message);
      document.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text('Cette photo n’a pas pu être intégrée au document.');
    }
  }
}

function rule(document) {
  const { left, right } = document.page.margins;
  document.save().strokeColor(RULE).lineWidth(1)
    .moveTo(left, document.y).lineTo(document.page.width - right, document.y).stroke().restore();
  document.moveDown(0.2);
}

export const pdfFilename = values => {
  const date = clean(values.date) || new Date().toISOString().slice(0, 10);
  const person = clean(values.personName)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `transmission-${person || 'suivi'}-${date}.pdf`;
};
