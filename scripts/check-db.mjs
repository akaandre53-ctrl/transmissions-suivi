/**
 * Contrôle d'intégration contre la vraie base.
 *
 *   npm run check:db
 *
 * À lancer avant chaque mise en production. Les tests de `npm test` sont
 * volontairement hors-ligne : ils ne peuvent pas voir ce qui ne casse qu'une
 * fois branché à Postgres.
 *
 * Le pool est forcé à UNE SEULE connexion, comme en environnement serverless.
 * C'est la condition qui a révélé un interblocage invisible en local : une
 * transaction détenait l'unique connexion pendant qu'une requête en réclamait
 * une autre au pool. Ne relevez pas cette limite pour faire passer le contrôle.
 *
 * Le compte, la transmission et la photo créés ici sont supprimés à la fin.
 */
process.env.DATABASE_MAX_CONNECTIONS = '1';

const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth/password.js');
const { query, closePool } = await import('../src/db/pool.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const EMAIL = `controle-${Date.now()}@controle.local`;
const PASSWORD = 'controle-integration-2026';
const REF = `controle${Date.now()}`;
const MARKER = 'CONTROLE TECHNIQUE';

let ok = 0;
let ko = 0;
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? 'OK   ' : 'ECHEC'} ${label}${detail ? ' : ' + detail : ''}`);
  condition ? ok++ : ko++;
};

const server = createApp().listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let cookie = '';
const call = async (path, options = {}) => {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      'X-Requested-With': 'transmission-app',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return response;
};

let userId = null;
let transmissionId = null;

/** Retire de la feuille les lignes portant le marqueur de contrôle. */
async function purgeSheetRows(marker, report) {
  const { config } = await import('../src/config.js');
  const { isSheetsConfigured } = await import('../src/config.js');
  if (!isSheetsConfigured()) return;

  try {
    const { google } = await import('googleapis');
    const raw = String(config.sheets.credentials).trim();
    const auth = new google.auth.GoogleAuth({
      ...(raw.startsWith('{') ? { credentials: JSON.parse(raw) } : { keyFile: raw }),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const id = config.sheets.spreadsheetId;
    const tab = config.sheets.tabName;

    const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
    const sheetId = meta.data.sheets.find(s => s.properties.title === tab)?.properties.sheetId;
    if (sheetId === undefined) return;

    const got = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${tab}!A:BZ` });
    const rows = got.data.values || [];
    // De bas en haut : supprimer par le haut décalerait les indices suivants.
    const targets = rows
      .map((row, index) => [row.join(' '), index])
      .filter(([text, index]) => index > 0 && text.includes(marker))
      .map(([, index]) => index)
      .reverse();

    for (const index of targets) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1 }
            }
          }]
        }
      });
    }
    report('feuille nettoyée', true, `${targets.length} ligne(s) de contrôle retirée(s)`);
  } catch (error) {
    report('feuille nettoyée', false, error.message);
  }
}

try {
  console.log('\nPool limité à 1 connexion (conditions de production)\n');

  const created = await query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,'aidant') RETURNING id`,
    [EMAIL, await hashPassword(PASSWORD), 'Compte de contrôle']
  );
  userId = created.rows[0].id;

  console.log('Connexion');
  check('mauvais mot de passe refusé',
    (await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: 'faux' } })).status === 401);
  const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  check('connexion acceptée', login.status === 200);
  check('session reconnue', (await call('/api/auth/me')).status === 200);

  console.log('\nPhoto');
  const upload = await call('/api/uploads', {
    method: 'POST',
    body: { clientRef: REF, fieldName: 'lunchPhoto', filename: 'controle.png', dataUrl: PNG }
  });
  const uploadBody = await upload.json();
  check('photo acceptée', upload.status === 201, uploadBody.error || '');
  const imageId = uploadBody.image?.id;

  console.log('\nEnregistrement');
  const values = {
    date: new Date().toISOString().slice(0, 10),
    personName: MARKER,
    caregiverName: 'Compte de contrôle',
    period: 'Journée complète',
    generalState: 'Bon',
    healthIssue: 'Non',
    medicationTaken: 'Oui, tous',
    hasExpense: 'Non',
    expenseItem: 'FANTOME',
    hasEvent: 'Non',
    daySummary: 'Contrôle avec accents : é è à ç.',
    recipientPhone: '+2250700000000'
  };

  const started = Date.now();
  const submit = await call('/api/transmissions', {
    method: 'POST',
    body: { clientRef: REF, values, imageIds: imageId ? [imageId] : [] }
  });
  const submitBody = await submit.json();
  // Le symptôme de l'interblocage était une attente de ~10 s suivie d'une 500.
  check('transmission enregistrée', submit.status === 201, submitBody.error || `${Date.now() - started} ms`);
  check('aucune attente anormale', Date.now() - started < 8000, `${Date.now() - started} ms`);
  transmissionId = submitBody.id;

  console.log('\nIdempotence et nettoyage des champs masqués');
  const again = await call('/api/transmissions', {
    method: 'POST',
    body: { clientRef: REF, values, imageIds: imageId ? [imageId] : [] }
  });
  check('renvoi sans doublon', (await again.json()).alreadySaved === true);
  const rows = await query('SELECT data FROM transmissions WHERE client_ref=$1', [REF]);
  check('une seule ligne', rows.rows.length === 1);
  check('donnée fantôme effacée', rows.rows[0]?.data.expenseItem === '');

  console.log('\nPDF et cloisonnement');
  const pdf = await fetch(`${base}/api/transmissions/${transmissionId}/pdf`, {
    headers: { 'X-Requested-With': 'transmission-app', Cookie: cookie }
  });
  const buffer = Buffer.from(await pdf.arrayBuffer());
  check('PDF produit', buffer.subarray(0, 5).toString('latin1') === '%PDF-', `${buffer.length} octets`);
  check('PDF refusé sans session',
    (await fetch(`${base}/api/transmissions/${transmissionId}/pdf`,
      { headers: { 'X-Requested-With': 'transmission-app' } })).status === 401);

} catch (error) {
  console.log('\nEXCEPTION :', error.message);
  ko++;
} finally {
  await query('DELETE FROM transmissions WHERE client_ref LIKE $1', ['controle%']).catch(() => {});
  if (userId) await query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
  const left = await query(
    `SELECT (SELECT count(*)::int FROM users WHERE email LIKE 'controle-%@controle.local') u,
            (SELECT count(*)::int FROM transmissions WHERE client_ref LIKE 'controle%') t,
            (SELECT count(*)::int FROM images WHERE client_ref LIKE 'controle%') i`
  ).catch(() => ({ rows: [{ u: -1, t: -1, i: -1 }] }));
  const l = left.rows[0];
  check('base nettoyée', l.u === 0 && l.t === 0 && l.i === 0, `${l.u} compte, ${l.t} transmission, ${l.i} photo`);

  // Le miroir a pu recopier la transmission de contrôle dans la vraie feuille.
  // La nettoyer aussi : sans cela, chaque exécution laissait une ligne de plus
  // dans le tableau que consulte la famille.
  await purgeSheetRows(MARKER, check);

  server.close();
  await closePool();
  console.log(`\n=== ${ok} reussites, ${ko} echecs ===`);
  process.exit(ko ? 1 : 0);
}
