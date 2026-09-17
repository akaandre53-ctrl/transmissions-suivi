import PDFDocument from 'pdfkit';
import { SECTIONS, isFieldActive } from '../domain/schema.js';
import { formatDateFr } from './message.service.js';

// Même palette que l'application : vert profond, crème, abricot.
const INK = '#1F2A26';
const MUTED = '#5B6863';
const BRAND = '#1F5C4B';
const ACCENT = '#D08158';
const ACCENT_TEXT = '#93492A';
const CREAM = '#FBF3EA';
const SAGE = '#E2EDE7';
const RULE = '#E7DFD3';

export const CREDIT_NAME = 'Prime Advisors SB, Inc.';
export const CREDIT_URL = 'https://www.primeadvisors-sb.com/';

const MARGIN = 46;
// La marge basse laisse la place au pied de page, dessiné sous la zone de texte.
const MARGIN_BOTTOM = 70;

const clean = value => String(value ?? '').trim();

/**
 * Rend la transmission en PDF.
 *
 * Le rendu est découplé de l'enregistrement : il lit une transmission déjà
 * persistée et peut être rejoué autant de fois que nécessaire. Un échec ici
 * n'a aucun effet sur les données.
 *
 * @param {object} transmission  ligne `transmissions` (data, summary, entry_date…)
 * @param {Array}  images        [{ category, mime_type, content: Buffer }]
 * @param {object} options       { compress }, compress:false sert aux tests,
 *                               qui doivent pouvoir relire le flux de texte.
 */
export function renderTransmissionPdf(transmission, images = [], { compress = true } = {}) {
  return new Promise((resolve, reject) => {
    const values = transmission.data || {};
    const document = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN_BOTTOM },
      compress,
      // Les pages restent en mémoire jusqu'à la fin : le pied de page porte
      // « Page n / total », qu'on ne connaît qu'une fois tout dessiné.
      bufferPages: true,
      info: {
        Title: `Transmission du ${clean(values.date) || transmission.entry_date}`,
        Author: clean(values.caregiverName) || 'Accompagnant(e)',
        Subject: `Suivi quotidien : ${clean(values.personName) || ''}`.trim(),
        Creator: `Transmission, by ${CREDIT_NAME}`
      }
    });

    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    try {
      drawHeader(document, values);
      drawSections(document, values);
      drawRecordStamp(document, transmission);
      drawImages(document, images);
      drawPageFooters(document);
      document.end();
    } catch (error) {
      // Sans ce filet, une erreur inattendue laisserait la promesse en suspens.
      reject(error);
    }
  });
}

const usableWidth = document => document.page.width - document.page.margins.left - document.page.margins.right;

function drawHeader(document, values) {
  const { left } = document.page.margins;
  const width = usableWidth(document);
  const top = document.page.margins.top;
  const height = 104;

  // Bandeau crème, soleil abricot en filigrane.
  document.save();
  document.roundedRect(left, top, width, height, 14).fill(CREAM);
  document.circle(left + width - 44, top + 34, 30).fillOpacity(0.28).fill(ACCENT);
  document.circle(left + width - 44, top + 34, 17).fillOpacity(0.35).fill(ACCENT);
  document.restore();

  const inner = left + 20;
  document.font('Helvetica-Bold').fontSize(8.5).fillColor(ACCENT_TEXT)
    .text('SUIVI QUOTIDIEN', inner, top + 18, { characterSpacing: 1.8 });
  document.font('Helvetica-Bold').fontSize(22).fillColor(INK)
    .text(clean(values.personName) || 'Transmission du jour', inner, top + 34, { width: width - 110 });

  const date = clean(values.date);
  const meta = [
    date ? formatDateFr(date) : null,
    clean(values.period),
    clean(values.caregiverName) ? `Accompagnant(e) : ${clean(values.caregiverName)}` : null
  ].filter(Boolean).join('   ·   ');
  document.font('Helvetica').fontSize(9.5).fillColor(MUTED)
    .text(meta, inner, top + 70, { width: width - 110 });

  document.x = left;
  document.y = top + height + 8;
}

function drawSections(document, values) {
  const { left } = document.page.margins;

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

    // Réserve la place du titre et d'une ligne : évite un titre orphelin en bas de page.
    if (document.y > document.page.height - document.page.margins.bottom - 70) {
      document.addPage();
    }

    document.moveDown(1);
    const titleY = document.y;
    document.save().roundedRect(left, titleY + 1.5, 4, 12, 2).fill(ACCENT).restore();
    document.font('Helvetica-Bold').fontSize(12).fillColor(BRAND)
      .text(section.title, left + 12, titleY, { width: usableWidth(document) - 12 });
    document.moveDown(0.25);
    const ruleY = document.y;
    document.save().strokeColor(RULE).lineWidth(0.8)
      .moveTo(left, ruleY).lineTo(left + usableWidth(document), ruleY).stroke().restore();
    document.y = ruleY + 7;

    const labelWidth = 170;
    for (const [label, value] of lines) {
      const startY = document.y;
      document.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTED)
        .text(label, left, startY, { width: labelWidth - 12 });
      const afterLabel = document.y;

      document.font('Helvetica').fontSize(10).fillColor(INK)
        .text(value, left + labelWidth, startY, { width: usableWidth(document) - labelWidth });

      document.y = Math.max(afterLabel, document.y) + 5;
      document.x = left;
    }
  }
}

function drawRecordStamp(document, transmission) {
  const { left } = document.page.margins;
  if (document.y > document.page.height - document.page.margins.bottom - 40) document.addPage();
  document.moveDown(1.2);
  const stamp = new Date(transmission.created_at || Date.now())
    .toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  document.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    .text(`Enregistré le ${stamp}   ·   Référence ${String(transmission.id).slice(0, 8)}`, left, document.y);
}

function drawImages(document, images) {
  for (const image of images) {
    if (!image?.content?.length) continue;
    document.addPage();
    const { left, top } = document.page.margins;
    const width = usableWidth(document);

    document.save().roundedRect(left, top + 1.5, 4, 13, 2).fill(ACCENT).restore();
    document.font('Helvetica-Bold').fontSize(13).fillColor(BRAND)
      .text(clean(image.category) || 'Photo de la journée', left + 12, top, { width: width - 12 });

    try {
      // Dimensions calculées ici plutôt que confiées à pdfkit : elles servent
      // à centrer la photo et à dessiner son cadre au bon endroit.
      const opened = document.openImage(image.content);
      const boxTop = document.y + 14;
      const boxHeight = document.page.height - document.page.margins.bottom - boxTop - 6;
      const scale = Math.min(width / opened.width, boxHeight / opened.height, 1.6);
      const drawWidth = opened.width * scale;
      const drawHeight = opened.height * scale;
      const x = left + (width - drawWidth) / 2;

      document.save();
      document.roundedRect(x, boxTop, drawWidth, drawHeight, 10).clip();
      document.image(opened, x, boxTop, { width: drawWidth, height: drawHeight });
      document.restore();
      document.save().roundedRect(x, boxTop, drawWidth, drawHeight, 10)
        .lineWidth(0.8).strokeColor(RULE).stroke().restore();
    } catch (error) {
      // Une photo illisible ne doit pas priver la famille du reste du document.
      console.error('[pdf] photo ignorée :', error.message);
      document.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text('Cette photo n’a pas pu être intégrée au document.', left, document.y + 14);
    }
  }
}

/**
 * Pied de chaque page : mention cliquable vers le site de Prime Advisors,
 * et pagination. Dessiné en dernier, sur les pages tenues en mémoire.
 */
function drawPageFooters(document) {
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    const { left } = document.page.margins;
    const width = usableWidth(document);
    const y = document.page.height - 44;

    // Écrire sous la marge basse fait créer une page vide à pdfkit : on la
    // lève le temps du pied de page, puis on la rétablit.
    const bottom = document.page.margins.bottom;
    document.page.margins.bottom = 0;

    document.save().strokeColor(RULE).lineWidth(0.8)
      .moveTo(left, y - 10).lineTo(left + width, y - 10).stroke().restore();

    // Chaque segment est posé à une abscisse mesurée, puis une seule zone
    // cliquable couvre l'ensemble. L'option `link` de pdfkit sur du texte
    // chaîné sans largeur produit une zone de dimension NaN.
    const segments = [
      ['Helvetica', MUTED, 'by '],
      ['Helvetica-Bold', BRAND, CREDIT_NAME],
      ['Helvetica', MUTED, '   ·   www.primeadvisors-sb.com']
    ];
    let x = left;
    document.fontSize(8.5);
    for (const [font, color, text] of segments) {
      document.font(font).fillColor(color).text(text, x, y, { lineBreak: false });
      x += document.widthOfString(text);
    }
    document.link(left, y - 2, x - left, 13, CREDIT_URL);

    document.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(`Page ${index - range.start + 1} / ${range.count}`, left, y, { width, align: 'right', lineBreak: false });

    document.page.margins.bottom = bottom;
  }
}

export const pdfFilename = values => {
  const date = clean(values.date) || new Date().toISOString().slice(0, 10);
  const person = clean(values.personName)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `transmission-${person || 'suivi'}-${date}.pdf`;
};
