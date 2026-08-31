import { existsSync } from 'node:fs';
import { google } from 'googleapis';
import { config, isSheetsConfigured } from '../config.js';
import { DATA_FIELDS, SHEET_HEADER } from '../domain/schema.js';
import * as repo from '../repositories/transmissions.repo.js';

let sheetsClient = null;
let headerChecked = false;

function getSheets() {
  if (sheetsClient) return sheetsClient;
  const raw = String(config.sheets.credentials || '').trim();
  if (!config.sheets.spreadsheetId || !raw) {
    throw new Error('Google Sheets n’est pas configuré.');
  }
  // La variable contient soit le JSON du compte de service (déploiement),
  // soit un chemin vers le fichier de clé (poste local).
  //
  // Un chemin ne fonctionne qu'en local : en hébergement serverless il n'y a
  // pas de fichier de clé à lire. Sans ce contrôle, l'échec remontait sous la
  // forme d'un ENOENT opaque au fond d'une trace googleapis.
  if (!raw.startsWith('{') && !existsSync(raw)) {
    throw new Error(
      `Clé Google introuvable au chemin « ${raw} ». En production, ` +
      'GOOGLE_APPLICATION_CREDENTIALS doit contenir le JSON complet de la clé, ' +
      'pas un chemin de fichier.'
    );
  }
  const auth = new google.auth.GoogleAuth({
    ...(raw.startsWith('{') ? { credentials: JSON.parse(raw) } : { keyFile: raw }),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

const columnName = number => {
  let name = '';
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
};

async function ensureHeader(sheets) {
  if (headerChecked) return;
  const range = `${config.sheets.tabName}!A1:${columnName(SHEET_HEADER.length)}1`;
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range
  });
  if (!current.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.spreadsheetId,
      range: `${config.sheets.tabName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADER] }
    });
  }
  headerChecked = true;
}

function toRow(transmission, photoCount) {
  const values = transmission.data || {};
  return [
    new Date(transmission.created_at).toLocaleString('fr-FR'),
    String(transmission.id).slice(0, 8),
    transmission.author_name || '',
    ...DATA_FIELDS.map(field => String(values[field.name] ?? '')),
    photoCount ? `${photoCount} photo(s)` : '',
    transmission.summary || ''
  ];
}

/**
 * Recopie une transmission dans la feuille.
 *
 * Cette fonction ne lève jamais : elle met à jour le statut de la ligne et
 * laisse la file de reprise faire le reste. C'est le point clé de la refonte —
 * Google Sheets ne peut plus faire échouer un enregistrement.
 */
export async function mirrorToSheet(transmission, photoCount = 0) {
  if (!isSheetsConfigured()) {
    // « skipped » et non « pending » : rien n'est en attente, la recopie n'est
    // simplement pas demandée. Renvoyer « pending » laissait croire à un retard
    // passager alors qu'il manque une variable d'environnement — et contredisait
    // le statut réellement enregistré en base.
    return { ok: false, status: 'skipped', reason: 'non_configuré' };
  }
  try {
    const sheets = getSheets();
    await withTimeout(ensureHeader(sheets), config.sheets.timeoutMs);
    await withTimeout(
      sheets.spreadsheets.values.append({
        spreadsheetId: config.sheets.spreadsheetId,
        range: `${config.sheets.tabName}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [toRow(transmission, photoCount)] }
      }),
      config.sheets.timeoutMs
    );
    await repo.markSheetSynced(transmission.id);
    return { ok: true, status: 'synced' };
  } catch (error) {
    // En cas d'échec d'authentification, on jette le client mis en cache :
    // une clé renouvelée sera reprise au prochain essai.
    sheetsClient = null;
    headerChecked = false;
    console.error('[sheets] recopie en échec :', error.message);
    await repo.markSheetFailed(transmission.id, error.message).catch(() => {});
    return { ok: false, status: 'pending', reason: error.message };
  }
}

/** Rejoue les transmissions en attente. Appelée par la route de reprise. */
export async function retryPending(limit = 20) {
  if (!isSheetsConfigured()) return { attempted: 0, synced: 0, skipped: 'non_configuré' };
  const pending = await repo.findPendingSheetSync(limit);
  let synced = 0;
  for (const transmission of pending) {
    const photoCount = await repo.countPhotos(transmission.id);
    const result = await mirrorToSheet(transmission, photoCount);
    if (result.ok) synced += 1;
  }
  return { attempted: pending.length, synced };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Google Sheets n’a pas répondu en ${ms} ms.`)), ms).unref?.()
    )
  ]);
}
