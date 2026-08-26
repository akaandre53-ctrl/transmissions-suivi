import 'dotenv/config';
import express from 'express';
import { google } from 'googleapis';
import PDFDocument from 'pdfkit';

const app = express();
const port = Number(process.env.PORT || 3000);
const clean = value => String(value ?? '').trim();
const item = (label, value) => clean(value) ? `${label} : ${clean(value)}` : null;
const columnName = number => { let name = ''; for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name; return name; };
const requests = new Map();
const fields = [
  ['date', 'Date'], ['personName', 'Personne accompagnee'], ['caregiverName', 'Accompagnant(e)'], ['period', 'Periode'], ['generalDescription', 'Description generale'],
  ['generalState', 'Etat general'], ['healthIssue', 'Malaise ou probleme'], ['healthIssueDetails', 'Detail malaise'], ['pain', 'Douleur ou gene'], ['painDetails', 'Detail douleur'], ['healthObservation', 'Observation sante'],
  ['bpLeftMorning', 'TA bras gauche matin'], ['bpRightMorning', 'TA bras droit matin'], ['pulseMorning', 'Pouls matin'], ['glucoseMorning', 'Glycemie matin'], ['bpLeftEvening', 'TA bras gauche soir'], ['bpRightEvening', 'TA bras droit soir'], ['pulseEvening', 'Pouls soir'], ['glucoseEvening', 'Glycemie soir'], ['weight', 'Poids'],
  ['medicationTaken', 'Medicaments pris'], ['medicationMissing', 'Medicaments non pris ou manquants'], ['medicationReason', 'Raison non-prise'], ['medicationObservation', 'Observation medicaments'],
  ['breakfastTaken', 'Petit-dejeuner pris'], ['breakfastDetails', 'Petit-dejeuner detail'], ['lunchTaken', 'Dejeuner pris'], ['lunchDetails', 'Dejeuner detail'], ['dinnerTaken', 'Diner pris'], ['dinnerDetails', 'Diner detail'], ['hydration', 'Hydratation'], ['nutritionObservation', 'Observation alimentation'],
  ['mobility', 'Mobilite'], ['activities', 'Activites'], ['activityFeeling', 'Ressenti activites'], ['mobilityObservation', 'Observation mobilite'],
  ['carePerformed', 'Soins realises'], ['careNotDone', 'Soin non realise'], ['careNotDoneDetails', 'Detail soin non realise'],
  ['rest', 'Repos'], ['mood', 'Humeur'], ['wellbeingObservation', 'Observation bien-etre'],
  ['hasExpense', 'Depense'], ['expenseItem', 'Achat'], ['expenseAmount', 'Montant'], ['expenseAuthorized', 'Achat autorise'], ['receiptAvailable', 'Preuve achat'], ['expenseComment', 'Commentaire achat'],
  ['hasEvent', 'Evenement particulier'], ['eventDescription', 'Description evenement'], ['attentionLevel', 'Niveau attention'], ['requiredAction', 'Action necessaire'],
  ['daySummary', 'Bilan general'], ['finalNotes', 'Autres remarques'], ['dayImages', 'Images de la journee'], ['recipientPhone', 'Numero WhatsApp destinataire']
];

app.use(express.json({ limit: '8mb' }));
app.use(express.static('public'));

app.use('/api', (req, res, next) => {
  const address = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (requests.get(address) || []).filter(time => now - time < 10 * 60 * 1000);
  if (recent.length >= 20) return res.status(429).json({ ok: false, error: 'Trop de tentatives. Reessayez dans quelques minutes.' });
  recent.push(now);
  requests.set(address, recent);
  next();
});

function makeMessage(data) {
  const groups = [
    ['Transmission du ' + (clean(data.date) || new Date().toLocaleDateString('fr-FR')), [item('Personne', data.personName), item('Accompagnant(e)', data.caregiverName), item('Periode', data.period), item('Description', data.generalDescription)]],
    ['Etat general et sante', [item('Etat general', data.generalState), item('Malaise ou probleme', data.healthIssue), item('Detail', data.healthIssueDetails), item('Douleur ou gene', data.pain), item('Detail', data.painDetails), item('Observation', data.healthObservation)]],
    ['Constantes', [item('TA bras gauche matin', data.bpLeftMorning), item('TA bras droit matin', data.bpRightMorning), item('Pouls matin', data.pulseMorning && `${data.pulseMorning} bpm`), item('Glycemie matin', data.glucoseMorning && `${data.glucoseMorning} g/L`), item('TA bras gauche soir', data.bpLeftEvening), item('TA bras droit soir', data.bpRightEvening), item('Pouls soir', data.pulseEvening && `${data.pulseEvening} bpm`), item('Glycemie soir', data.glucoseEvening && `${data.glucoseEvening} g/L`), item('Poids', data.weight && `${data.weight} kg`)]],
    ['Medicaments', [item('Prise prevue', data.medicationTaken), item('Non pris ou manquants', data.medicationMissing), item('Raison', data.medicationReason), item('Observation', data.medicationObservation)]],
    ['Alimentation et hydratation', [item('Petit-dejeuner', data.breakfastTaken), item('Detail petit-dejeuner', data.breakfastDetails), item('Dejeuner', data.lunchTaken), item('Detail dejeuner', data.lunchDetails), item('Diner', data.dinnerTaken), item('Detail diner', data.dinnerDetails), item('Hydratation', data.hydration), item('Observation', data.nutritionObservation)]],
    ['Activites et mobilite', [item('Deplacement ou marche', data.mobility), item('Activites', data.activities), item('Ressenti', data.activityFeeling), item('Observation', data.mobilityObservation)]],
    ['Hygiene et soins', [item('Soins realises', data.carePerformed), item('Soin non realise', data.careNotDone), item('Detail', data.careNotDoneDetails)]],
    ['Repos et bien-etre', [item('Repos', data.rest), item('Humeur', data.mood), item('Observation', data.wellbeingObservation)]],
    ['Achats et depenses', [item('Depense', data.hasExpense), item('Produit ou service', data.expenseItem), item('Montant', data.expenseAmount && `${data.expenseAmount} FCFA`), item('Autorise ou prevu', data.expenseAuthorized), item('Preuve disponible', data.receiptAvailable), item('Commentaire', data.expenseComment)]],
    ['Evenements et points d’attention', [item('Evenement', data.hasEvent), item('Description', data.eventDescription), item('Niveau d’attention', data.attentionLevel), item('Action necessaire', data.requiredAction)]],
    ['Bilan de la journee', [item('Bilan', data.daySummary), item('Autres remarques', data.finalNotes), item('Images jointes', data.dayImages)]]
  ];
  return groups.map(([title, values]) => [title, ...values.filter(Boolean)].join('\n')).join('\n\n');
}

function getAuth() {
  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('GOOGLE_SHEET_ID et GOOGLE_APPLICATION_CREDENTIALS doivent etre renseignes.');
  const credentials = clean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const options = credentials.startsWith('{') ? { credentials: JSON.parse(credentials) } : { keyFile: credentials };
  return new google.auth.GoogleAuth({ ...options, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
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
      const pdfLines = lines.slice(1).filter(line => !line.startsWith('Images jointes :'));
      document.moveDown(0.2).fontSize(10).fillColor('#222').text(pdfLines.join('\n') || 'Aucune information renseignee.');
    }
    for (const image of Array.isArray(data.imageData) ? data.imageData : []) {
      if (!clean(image.data).startsWith('data:image/')) continue;
      document.addPage().fontSize(13).fillColor('#176b5a').text(image.category || 'Photo de la journee');
      document.image(image.data, { fit: [510, 700], align: 'center', valign: 'center' });
    }
    document.end();
  });
}

app.post('/api/transmissions', async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ ok: false, error: 'Donnees de transmission invalides.' });
  const data = req.body;
  if (Array.isArray(data.imageData) && data.imageData.length > 5) return res.status(400).json({ ok: false, error: 'Cinq images maximum sont autorisees.' });
  const message = makeMessage(data);
  try {
    await saveToSheet(data, message);
    const pdf = await pdfBuffer(data, message);
    res.json({ ok: true, message, pdf: pdf.toString('base64'), filename: `transmission-${clean(data.date) || 'du-jour'}.pdf` });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

export default app;

if (process.env.VERCEL !== '1') app.listen(port, () => console.log(`Application ouverte sur http://localhost:${port}`));
