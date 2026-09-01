import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';

/**
 * Tests du contrat HTTP, sans base de données.
 *
 * Ils vérifient surtout la garantie centrale de la refonte : une requête vers
 * /api reçoit TOUJOURS du JSON. C'est ce qui manquait, le navigateur recevait
 * une page HTML d'erreur et échouait sur response.json() avec un message
 * incompréhensible pour l'utilisatrice.
 */

let server;
let base;

const call = (path, options = {}) => fetch(`${base}${path}`, {
  ...options,
  headers: { 'X-Requested-With': 'transmission-app', ...(options.headers || {}) }
});

before(async () => {
  server = createApp().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => server.close(resolve)));

describe('contrat JSON', () => {
  test('/api/schema sert le schéma sans authentification', async () => {
    const response = await call('/api/schema');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.sections));
    assert.ok(body.sections.length >= 10);
    assert.equal(typeof body.maxImages, 'number');
  });

  test('une route /api inconnue répond en JSON, pas en HTML', async () => {
    const response = await call('/api/route-qui-nexiste-pas');
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    assert.equal((await response.json()).code, 'not_found');
  });

  test('un corps JSON malformé donne une erreur lisible', async () => {
    const response = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ceci nest pas du json'
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, 'invalid_json');
  });

  test('un corps trop volumineux est refusé en JSON avec un conseil utile', async () => {
    const response = await call('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(4 * 1024 * 1024) })
    });
    assert.equal(response.status, 413);
    const body = await response.json();
    assert.equal(body.code, 'payload_too_large');
    assert.match(body.error, /photos/i);
  });
});

describe('authentification', () => {
  test('/api/auth/me répond 401 sans session', async () => {
    const response = await call('/api/auth/me');
    assert.equal(response.status, 401);
    assert.equal((await response.json()).user, null);
  });

  test('une route protégée refuse un visiteur anonyme', async () => {
    const response = await call('/api/transmissions');
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'unauthorized');
  });

  test('l’envoi d’une transmission exige une session', async () => {
    const response = await call('/api/transmissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRef: 'abcdefgh1234', values: {} })
    });
    assert.equal(response.status, 401);
  });
});

describe('accès aux photos', () => {
  test('une photo n’est jamais servie à un visiteur anonyme', async () => {
    const response = await call('/api/uploads/3f7a1c2e-8b44-4c11-9a02-000000000001');
    assert.equal(response.status, 401, 'les photos de la personne accompagnée doivent être protégées');
  });

  test('un identifiant qui n’est pas un UUID donne un 404, pas une erreur serveur', async () => {
    const response = await call('/api/uploads/nimporte-quoi');
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'not_found');
  });

  test('un identifiant de transmission mal formé donne aussi un 404', async () => {
    const response = await call('/api/transmissions/pas-un-uuid/pdf');
    assert.equal(response.status, 404);
  });
});

describe('protection CSRF', () => {
  test('une écriture sans l’en-tête d’origine est rejetée', async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.ci', password: 'motdepasse12' })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'forbidden');
  });

  test('une lecture reste possible sans cet en-tête', async () => {
    const response = await fetch(`${base}/api/schema`);
    assert.equal(response.status, 200);
  });
});

describe('en-têtes et fichiers statiques', () => {
  test('les en-têtes de sécurité sont posés', async () => {
    const response = await call('/api/schema');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  test('la page du formulaire est servie', async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Transmission du jour/);
    // Le zoom ne doit jamais être bloqué : on inspecte la balise viewport
    // elle-même, pas le reste de la page.
    const viewport = /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] || '';
    assert.match(viewport, /width=device-width/);
    assert.doesNotMatch(viewport, /user-scalable\s*=\s*no|maximum-scale/);
  });

  test('la feuille de style et les modules sont servis', async () => {
    for (const path of ['/css/app.css', '/js/app.js', '/js/api.js', '/js/form.js']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, `${path} devrait être servi`);
    }
  });
});

describe('erreurs internes', () => {
  test('une réponse en erreur ne divulgue aucun détail technique', async () => {
    // La base est injoignable pendant les tests (voir setup.js), donc on attend
    // une 500. L'assertion qui compte n'est pas le code mais le contenu : aucun
    // message ne doit laisser filtrer de chaîne de connexion, d'adresse d'hôte
    // ou de trace interne.
    const response = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'marie@exemple.ci', password: 'motdepasse12' })
    });
    assert.ok([401, 500].includes(response.status), `statut inattendu : ${response.status}`);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    assert.doesNotMatch(
      body.error,
      /DATABASE_URL|postgres|ECONNREFUSED|neon\.tech|\baws\b|\.js:\d+|at [A-Za-z]+ \(/i
    );
  });

  test('les tests ne touchent jamais la base réelle', async () => {
    // Garde-fou : si ce test échoue, c'est que setup.js n'a pas été chargé et
    // que la suite s'exécute contre la base du poste de développement.
    assert.match(process.env.DATABASE_URL || '', /^postgresql:\/\/test:test@127\.0\.0\.1:1\//);
  });
});
