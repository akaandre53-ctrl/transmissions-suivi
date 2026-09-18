/**
 * Contrôle d'intégration contre la vraie base.
 *
 *   npm run check:db
 *
 * À lancer avant chaque mise en production. Les tests de `npm test` sont
 * volontairement hors ligne : ils ne voient pas ce qui ne casse qu'une fois
 * branché à Postgres.
 *
 * Deux choses sont éprouvées ici plus qu'ailleurs :
 *
 *   1. Le pool est forcé à UNE SEULE connexion, comme en environnement
 *      serverless. C'est la condition qui a révélé un interblocage invisible en
 *      local. Ne relevez pas cette limite pour faire passer le contrôle.
 *
 *   2. Le cloisonnement entre familles. Deux personnes accompagnées, deux
 *      comptes famille : chacun doit rester aveugle aux transmissions, au PDF
 *      et aux photos de l'autre. Avant la migration 002, un compte famille
 *      voyait tout.
 *
 * Tout ce qui est créé ici porte le préfixe « controle » et est supprimé à la
 * fin, y compris la ligne recopiée dans la feuille Google.
 */
process.env.DATABASE_MAX_CONNECTIONS = '1';

const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth/password.js');
const { query, closePool } = await import('../src/db/pool.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const STAMP = Date.now();
const PASSWORD = 'controle-integration-2026';
const MARKER = 'CONTROLE TECHNIQUE';
const ref = suffix => `controle${STAMP}${suffix}`;

let ok = 0;
let ko = 0;
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? 'OK   ' : 'ECHEC'} ${label}${detail ? ' : ' + detail : ''}`);
  condition ? ok++ : ko++;
};

const server = createApp().listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

/** Une session par compte : chacune garde son propre cookie. */
function session() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        'X-Requested-With': 'transmission-app',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return response;
  };
}

async function account(role, label) {
  const email = `controle-${label}-${STAMP}@controle.local`;
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING id`,
    [email, await hashPassword(PASSWORD), `Contrôle ${label}`, role]
  );
  const call = session();
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  if (login.status !== 200) throw new Error(`connexion impossible pour ${label}`);
  return { id: rows[0].id, email, call };
}

async function beneficiary(name) {
  const { rows } = await query('INSERT INTO beneficiaries (full_name) VALUES ($1) RETURNING id', [name]);
  return rows[0].id;
}

const link = (userId, beneficiaryId) =>
  query('INSERT INTO user_beneficiaries (user_id, beneficiary_id) VALUES ($1,$2)', [userId, beneficiaryId]);

const json = async response => response.json().catch(() => ({}));

const baseValues = personName => ({
  date: new Date().toISOString().slice(0, 10),
  personName,
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
});

/** Retire de la feuille les lignes portant le marqueur de contrôle. */
async function purgeSheetRows() {
  const { config, isSheetsConfigured } = await import('../src/config.js');
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
    // De bas en haut : supprimer par le haut décalerait les indices suivants.
    const targets = (got.data.values || [])
      .map((row, index) => [row.join(' '), index])
      .filter(([text, index]) => index > 0 && text.includes(MARKER))
      .map(([, index]) => index)
      .reverse();
    for (const index of targets) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1 } } }] }
      });
    }
    check('feuille nettoyée', true, `${targets.length} ligne(s) de contrôle retirée(s)`);
  } catch (error) {
    check('feuille nettoyée', false, error.message);
  }
}

try {
  console.log('\nPool limité à 1 connexion (conditions de production)');

  const personA = await beneficiary(`${MARKER} A ${STAMP}`);
  const personB = await beneficiary(`${MARKER} B ${STAMP}`);
  const aidante = await account('aidant', 'aidante');
  const familleA = await account('famille', 'famille-a');
  const familleB = await account('famille', 'famille-b');
  const admin = await account('admin', 'admin');
  await link(aidante.id, personA);
  await link(familleA.id, personA);
  await link(familleB.id, personB);

  console.log('\nConnexion');
  const anonymous = session();
  check('mauvais mot de passe refusé',
    (await anonymous('/api/auth/login', { method: 'POST', body: { email: aidante.email, password: 'faux' } })).status === 401);
  check('session reconnue', (await aidante.call('/api/auth/me')).status === 200);
  check('aucune réponse d’API mise en cache',
    (await aidante.call('/api/auth/me')).headers.get('cache-control') === 'no-store');

  console.log('\nPersonnes proposées à chaque compte');
  const listFor = async who => (await json(await who.call('/api/beneficiaries'))).beneficiaries?.map(b => b.id) || [];
  const visibleAidante = await listFor(aidante);
  check('l’aidante voit la personne qui lui est confiée', visibleAidante.includes(personA));
  check('l’aidante ne voit pas les autres', !visibleAidante.includes(personB));
  const visibleB = await listFor(familleB);
  check('la famille B ne voit que sa personne', visibleB.length === 1 && visibleB[0] === personB);

  console.log('\nPhoto et enregistrement');
  const upload = await aidante.call('/api/uploads', {
    method: 'POST',
    body: { clientRef: ref('a'), fieldName: 'lunchPhoto', filename: 'controle.png', dataUrl: PNG }
  });
  const uploadBody = await json(upload);
  check('photo acceptée', upload.status === 201, uploadBody.error || '');
  const imageId = uploadBody.image?.id;

  const started = Date.now();
  const submit = await aidante.call('/api/transmissions', {
    method: 'POST',
    body: { clientRef: ref('a'), values: baseValues(personA), imageIds: imageId ? [imageId] : [] }
  });
  const submitBody = await json(submit);
  const elapsed = Date.now() - started;
  check('transmission enregistrée', submit.status === 201, submitBody.error || `${elapsed} ms`);
  // Le symptôme de l'interblocage était une attente de ~10 s suivie d'une 500.
  check('aucune attente anormale', elapsed < 8000, `${elapsed} ms`);
  const transmissionId = submitBody.id;

  const stored = await query('SELECT beneficiary_id, person_name, data FROM transmissions WHERE id = $1', [transmissionId]);
  check('rattachée à la bonne personne', stored.rows[0]?.beneficiary_id === personA);
  check('le nom est enregistré, pas l’identifiant', stored.rows[0]?.person_name.startsWith(`${MARKER} A`));
  check('donnée fantôme effacée', stored.rows[0]?.data.expenseItem === '');

  const again = await aidante.call('/api/transmissions', {
    method: 'POST',
    body: { clientRef: ref('a'), values: baseValues(personA), imageIds: imageId ? [imageId] : [] }
  });
  check('renvoi sans doublon', (await json(again)).alreadySaved === true);

  console.log('\nSaisies refusées');
  const forB = await aidante.call('/api/transmissions', {
    method: 'POST', body: { clientRef: ref('b'), values: baseValues(personB), imageIds: [] }
  });
  const forBBody = await json(forB);
  check('l’aidante ne saisit pas pour une personne non confiée',
    forB.status === 400 && forBBody.details?.some(d => d.field === 'personName'));
  const typed = await aidante.call('/api/transmissions', {
    method: 'POST', body: { clientRef: ref('c'), values: baseValues('Maman Barakissa'), imageIds: [] }
  });
  check('un nom tapé à la main est refusé', typed.status === 400);
  const familyWrite = await familleA.call('/api/transmissions', {
    method: 'POST', body: { clientRef: ref('d'), values: baseValues(personA), imageIds: [] }
  });
  check('la famille ne saisit jamais', familyWrite.status === 403);
  const leaked = await query('SELECT count(*)::int n FROM transmissions WHERE client_ref = ANY($1)', [[ref('b'), ref('c'), ref('d')]]);
  check('aucune saisie refusée n’a été écrite', leaked.rows[0].n === 0);

  console.log('\nCloisonnement entre familles');
  const idsIn = async (who, query = '') =>
    (await json(await who.call(`/api/transmissions?limit=100${query}`))).items?.map(i => i.id) || [];

  check('la famille A voit la transmission de sa personne', (await idsIn(familleA)).includes(transmissionId));
  check('la famille B ne la voit pas dans son historique', !(await idsIn(familleB)).includes(transmissionId));
  check('la famille B ne la voit pas en filtrant sur A', (await idsIn(familleB, `&beneficiaryId=${personA}`)).length === 0);
  check('l’admin la voit', (await idsIn(admin)).includes(transmissionId));

  const pdfStatus = async who => (await who.call(`/api/transmissions/${transmissionId}/pdf`)).status;
  check('PDF accessible à la famille A', await pdfStatus(familleA) === 200);
  check('PDF refusé à la famille B', await pdfStatus(familleB) === 404);
  check('fiche refusée à la famille B', (await familleB.call(`/api/transmissions/${transmissionId}`)).status === 404);
  check('PDF refusé sans session', (await anonymous(`/api/transmissions/${transmissionId}/pdf`)).status === 401);

  const photoStatus = async who => (await who.call(`/api/uploads/${imageId}`)).status;
  check('photo accessible à la famille A', await photoStatus(familleA) === 200);
  check('photo refusée à la famille B', await photoStatus(familleB) === 404);

  const pdf = Buffer.from(await (await familleA.call(`/api/transmissions/${transmissionId}/pdf`)).arrayBuffer());
  check('PDF valide', pdf.subarray(0, 5).toString('latin1') === '%PDF-', `${pdf.length} octets`);
  // Au moins un objet image, pas exactement un : une image avec transparence
  // en produit deux (l'image et son masque).
  const imageObjects = (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
  check('photo dessinée dans le PDF', imageObjects >= 1, `${imageObjects} objet(s) image`);

  console.log('\nAdministration des comptes');
  const patch = (id, body) => admin.call(`/api/admin/users/${id}`, { method: 'PATCH', body });

  check('renommage refusé si le nom est vide', (await patch(aidante.id, { fullName: ' ' })).status === 400);
  check('adresse déjà prise refusée', (await patch(aidante.id, { email: familleA.email })).status === 400);
  check('mot de passe trop court refusé', (await patch(aidante.id, { password: 'court' })).status === 400);
  check('l’admin ne peut pas se désactiver', (await patch(admin.id, { isActive: false })).status === 400);

  const nouveauNom = `Contrôle renommée ${STAMP}`;
  check('renommage accepté', (await patch(aidante.id, { fullName: nouveauNom })).status === 200);
  const renamed = await query('SELECT full_name FROM users WHERE id = $1', [aidante.id]);
  check('le nouveau nom est en base', renamed.rows[0].full_name === nouveauNom);
  const listed = await json(await admin.call('/api/transmissions?limit=100'));
  check('l’historique affiche déjà le nouveau nom',
    listed.items.find(i => i.id === transmissionId)?.authorName === nouveauNom);

  const nouvelEmail = `controle-renommee-${STAMP}@controle.local`;
  check('changement d’adresse accepté', (await patch(aidante.id, { email: nouvelEmail })).status === 200);

  const nouveauMotDePasse = 'nouveau-mot-de-passe-2026';
  const reset = await patch(aidante.id, { password: nouveauMotDePasse });
  check('mot de passe remplacé', reset.status === 200 && (await json(reset)).sessionsRevoked === true);
  // Le remplacement doit couper les sessions ouvertes, sinon l'appareil dont il
  // fallait retirer l'accès reste connecté.
  check('la session ouverte de l’aidante est coupée', (await aidante.call('/api/auth/me')).status === 401);

  const ancien = await anonymous('/api/auth/login', { method: 'POST', body: { email: nouvelEmail, password: PASSWORD } });
  check('l’ancien mot de passe ne fonctionne plus', ancien.status === 401);
  const nouveau = session();
  const ouverture = await nouveau('/api/auth/login', { method: 'POST', body: { email: nouvelEmail, password: nouveauMotDePasse } });
  check('la nouvelle adresse et le nouveau mot de passe ouvrent la session', ouverture.status === 200);
  check('la famille ne peut pas modifier un compte',
    (await familleA.call(`/api/admin/users/${aidante.id}`, { method: 'PATCH', body: { fullName: 'Pirate' } })).status === 403);

} catch (error) {
  console.log('\nEXCEPTION :', error.message);
  ko++;
} finally {
  // Ordre imposé par les clés étrangères : transmissions (et leurs photos),
  // puis comptes (et leurs rattachements), puis fiches.
  await query("DELETE FROM transmissions WHERE client_ref LIKE 'controle%'").catch(() => {});
  await query("DELETE FROM users WHERE email LIKE 'controle-%@controle.local'").catch(() => {});
  await query('DELETE FROM beneficiaries WHERE full_name LIKE $1', [`${MARKER}%`]).catch(() => {});
  const left = await query(
    `SELECT (SELECT count(*)::int FROM users WHERE email LIKE 'controle-%@controle.local') u,
            (SELECT count(*)::int FROM transmissions WHERE client_ref LIKE 'controle%') t,
            (SELECT count(*)::int FROM images WHERE client_ref LIKE 'controle%') i,
            (SELECT count(*)::int FROM beneficiaries WHERE full_name LIKE $1) b`,
    [`${MARKER}%`]
  ).catch(() => ({ rows: [{ u: -1, t: -1, i: -1, b: -1 }] }));
  const l = left.rows[0];
  console.log('\nNettoyage');
  check('base nettoyée', l.u === 0 && l.t === 0 && l.i === 0 && l.b === 0,
    `${l.u} compte, ${l.t} transmission, ${l.i} photo, ${l.b} fiche`);
  await purgeSheetRows();

  server.close();
  await closePool();
  console.log(`\n=== ${ok} reussites, ${ko} echecs ===`);
  process.exit(ko ? 1 : 0);
}
