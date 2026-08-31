import 'dotenv/config';

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'oui'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isServerless: process.env.VERCEL === '1',
  port: int(process.env.PORT, 3000),

  database: {
    url: process.env.DATABASE_URL || '',
    // Neon, Supabase et la plupart des Postgres hébergés exigent TLS.
    // En local (postgres://localhost) on le désactive.
    ssl: bool(process.env.DATABASE_SSL, !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')),
    // Le certificat du serveur est vérifié par défaut. Neon, Supabase et les
    // autres hébergeurs présentent un certificat signé par une autorité
    // publique : la vérification passe sans réglage. Ne la désactiver que pour
    // un Postgres auto-signé, en sachant que sans elle rien ne distingue le
    // vrai serveur d'un intercepteur.
    sslVerify: bool(process.env.DATABASE_SSL_VERIFY, true),
    maxConnections: int(process.env.DATABASE_MAX_CONNECTIONS, process.env.VERCEL === '1' ? 1 : 5)
  },

  session: {
    cookieName: 'tm_session',
    // Durée longue et volontaire : l'aidant·e remplit sur son téléphone au fil
    // de la journée et ne doit pas être déconnecté·e en pleine saisie.
    ttlDays: int(process.env.SESSION_TTL_DAYS, 30)
  },

  sheets: {
    spreadsheetId: process.env.GOOGLE_SHEET_ID || '',
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    tabName: process.env.GOOGLE_SHEET_TAB || 'Transmissions',
    // Le miroir Sheets ne doit jamais faire échouer un enregistrement.
    timeoutMs: int(process.env.SHEETS_TIMEOUT_MS, 6000),
    maxAttempts: int(process.env.SHEETS_MAX_ATTEMPTS, 5)
  },

  cronSecret: process.env.CRON_SECRET || ''
};

export const isSheetsConfigured = () =>
  Boolean(config.sheets.spreadsheetId && config.sheets.credentials);

export const isDatabaseConfigured = () => Boolean(config.database.url);

/**
 * Vérifie au démarrage ce qui manque. On n'arrête le serveur que si la base
 * est absente : sans elle, plus rien ne fonctionne. Sheets est optionnel.
 */
export function describeConfig() {
  const problems = [];
  const warnings = [];
  if (!isDatabaseConfigured()) problems.push('DATABASE_URL est absent : impossible de démarrer.');
  if (!isSheetsConfigured()) {
    warnings.push('Google Sheets non configuré : les transmissions sont enregistrées en base, la copie vers la feuille est mise en attente.');
  }
  return { problems, warnings };
}
