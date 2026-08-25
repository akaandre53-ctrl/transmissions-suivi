import 'dotenv/config';
import express from 'express';
import { google } from 'googleapis';
import PDFDocument from 'pdfkit';

const app = express();
const port = Number(process.env.PORT || 3000);
const clean = value => String(value ?? '').trim();
const item = (label, value) => clean(value) ? `${label} : ${clean(value)}` : null;
const columnName = number => { let name = ''; for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name; return name; };
const fields = [
  ['date', 'Date'], ['sleep', 'Sommeil'], ['wake', 'Etat au reveil'], ['complaints', 'Plaintes / inconforts'],
  ['bpLeftMorning', 'TA bras gauche matin'], ['bpRightMorning', 'TA bras droit matin'], ['pulseMorning', 'Pouls matin'], ['glucoseMorning', 'Glycemie matin'],
  ['bpLeftEvening', 'TA bras gauche soir'], ['bpRightEvening', 'TA bras droit soir'], ['pulseEvening', 'Pouls soir'], ['glucoseEvening', 'Glycemie soir'],
  ['weight', 'Poids'], ['breakfast', 'Petit-dejeuner'], ['morningMeds', 'Medicaments matin'], ['eveningMeds', 'Medicaments 18 h'],
  ['morningExpenseAmount', 'Depenses matin'], ['morningExpenseReason', 'Motif depense matin'], ['lunchDinner', 'Repas'], ['activities', 'Activites'],
  ['naps', 'Siestes'], ['transit', 'Transit'], ['otherExpenses', 'Autres depenses'], ['morningNotes', 'Remarques'], ['eveningNotes', 'Remarques du soir'],
  ['daySummary', 'Bilan general'], ['recipientPhone', 'Numero WhatsApp destinataire'], ['dayImages', 'Images de la journee']
];

app.use(express.json({ limit: '12mb' }));
app.use(express.static('public'));

function makeMessage(data) {
  const groups = [
    ['Transmission du ' + (clean(data.date) || new Date().toLocaleDateString('fr-FR')), [item('Sommeil', data.sleep), item('Reveil', data.wake), item('Plaintes', data.complaints)]],
    ['Constantes', [item('TA gauche matin', data.bpLeftMorning), item('TA droite matin', data.bpRightMorning), item('Pouls matin', data.pulseMorning && `${data.pulseMorning} bpm`), item('Glycemie matin', data.glucoseMorning && `${data.glucoseMorning} g/L`), item('Poids', data.weight && `${data.weight} kg`), item('TA gauche soir', data.bpLeftEvening), item('TA droite soir', data.bpRightEvening), item('Pouls soir', data.pulseEvening && `${data.pulseEvening} bpm`), item('Glycemie soir', data.glucoseEvening && `${data.glucoseEvening} g/L`)]],
    ['Repas et soins', [item('Petit-dejeuner', data.breakfast), item('Medicaments matin', data.morningMeds), item('Medicaments 18 h', data.eveningMeds), item('Repas', data.lunchDinner)]],
    ['Journee', [item('Depenses matin', data.morningExpenseAmount && `${data.morningExpenseAmount} FCFA`), item('Motif', data.morningExpenseReason), item('Activites', data.activities), item('Siestes', data.naps), item('Transit', data.transit), item('Autres depenses', data.otherExpenses)]],
    ['Bilan et remarques', [item('Bilan general', data.daySummary), item('Remarques', data.morningNotes), item('Remarques du soir', data.eveningNotes), item('Images jointes', data.dayImages)]]
  ];
  return groups.map(([title, values]) => [title, ...values.filter(Boolean)].join('\n')).join('\n\n');
}

function getAuth() {
  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('GOOGLE_SHEET_ID et GOOGLE_APPLICATION_CREDENTIALS doivent etre renseignes.');
  return new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

async function saveToSheet(data, message) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const header = ['Horodatage', ...fields.map(([, label]) => label), 'Resume WhatsApp'];
  const check = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `Transmissions!A1:${columnName(header.length)}1` });
  if (!check.data.values?.length) await sheets.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Transmissions!A1', valueInputOption: 'RAW', requestBody: { values: [header] } });
  await sheets.spreadsheets.values.append({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Transmissions!A1', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[new Date().toLocaleString('fr-FR'), ...fields.map(([key]) => clean(data[key])), message]] } });
}

function pdfBuffer(data, message) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 42, info: { Title: 'Transmission du jour' } });
    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.fontSize(20).fillColor('#176b5a').text('Transmission du jour', { align: 'center' });
    document.moveDown().fontSize(10).fillColor('#333').text(`Date : ${clean(data.date) || new Date().toLocaleDateString('fr-FR')}`, { align: 'center' });
    for (const block of message.split('\n\n')) {
      const lines = block.split('\n');
      document.moveDown(1).fontSize(13).fillColor('#176b5a').text(lines[0]);
      document.moveDown(0.2).fontSize(10).fillColor('#222').text(lines.slice(1).join('\n') || 'Aucune information renseignee.');
    }
    for (const image of Array.isArray(data.imageData) ? data.imageData : []) {
      if (!clean(image.data).startsWith('data:image/')) continue;
      document.addPage().fontSize(13).fillColor('#176b5a').text(image.name || 'Image de la journee');
      document.image(image.data, { fit: [510, 700], align: 'center', valign: 'center' });
    }
    document.end();
  });
}

app.post('/api/transmissions', async (req, res) => {
  const data = req.body || {};
  const message = makeMessage(data);
  try {
    await saveToSheet(data, message);
    const pdf = await pdfBuffer(data, message);
    res.json({ ok: true, message, pdf: pdf.toString('base64'), filename: `transmission-${clean(data.date) || 'du-jour'}.pdf` });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

app.listen(port, () => console.log(`Application ouverte sur http://localhost:${port}`));
