/**
 * Chargé avant les fichiers de test, via `node --import ./tests/setup.js`.
 *
 * Il fixe DATABASE_URL sur une adresse volontairement injoignable. dotenv
 * n'écrase jamais une variable déjà définie : le `.env` du poste de
 * développement est donc ignoré, et la suite de tests ne peut pas atteindre la
 * base réelle. Sans cette précaution, `npm test` enverrait de vraies requêtes
 *, y compris des tentatives de connexion, vers la base de production.
 *
 * Le port 1 refuse immédiatement, ce qui garde les tests rapides plutôt que
 * de les faire attendre l'expiration d'un délai réseau.
 */
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
process.env.DATABASE_SSL = 'false';
process.env.NODE_ENV = 'test';

// Les identifiants Google éventuellement présents dans .env ne doivent pas
// servir pendant les tests.
delete process.env.GOOGLE_SHEET_ID;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
