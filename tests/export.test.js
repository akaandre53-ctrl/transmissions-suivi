import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CSV_HEADER, buildTransmissionsCsv, csvFilename } from '../src/services/export.service.js';

const row = (overrides = {}) => ({
  id: 'x',
  entry_date: '2026-09-15',
  person_name: 'Maman Barakissa',
  author_name: 'Awa Koffi',
  created_at: new Date('2026-09-15T18:30:00Z'),
  photo_count: 2,
  data: {
    date: '2026-09-15',
    personName: 'Maman Barakissa',
    caregiverName: 'Awa Koffi',
    recipientPhone: '+2250700000000',
    generalState: 'Bon',
    weight: '62.5',
    pulseMorning: '74',
    daySummary: 'Journée calme.',
    ...overrides
  }
});

const lines = csv => csv.replace(/^﻿/, '').trim().split('\r\n');
const cells = line => line.split(';');

describe('export CSV', () => {
  test('commence par un BOM, sans quoi Excel casse les accents', () => {
    assert.ok(buildTransmissionsCsv([]).startsWith('﻿'));
  });

  test('l’en-tête reprend les libellés du schéma avec leur unité', () => {
    assert.deepEqual(CSV_HEADER.slice(0, 5), ['Horodatage', 'Date', 'Personne accompagnée', 'Saisi par', 'Photos']);
    assert.ok(CSV_HEADER.includes('Poids (kg)'));
    assert.ok(CSV_HEADER.includes('Pouls (matin) (bpm)'));
  });

  test('le numéro WhatsApp du destinataire n’est pas exporté', () => {
    const csv = buildTransmissionsCsv([row()]);
    assert.ok(!CSV_HEADER.includes('Numéro WhatsApp du destinataire'));
    assert.ok(!csv.includes('+2250700000000'));
  });

  test('une ligne porte les colonnes d’en-tête puis les champs', () => {
    const [, data] = lines(buildTransmissionsCsv([row()]));
    const values = cells(data);
    assert.equal(values.length, CSV_HEADER.length);
    assert.equal(values[1], '2026-09-15');
    assert.equal(values[2], 'Maman Barakissa');
    assert.equal(values[3], 'Awa Koffi');
    assert.equal(values[4], '2');
  });

  test('les nombres sortent avec une virgule décimale', () => {
    const [, data] = lines(buildTransmissionsCsv([row()]));
    const poids = cells(data)[CSV_HEADER.indexOf('Poids (kg)')];
    assert.equal(poids, '62,5', 'Excel en français attend une virgule');
  });

  test('un texte contenant le séparateur ou des guillemets est protégé', () => {
    const csv = buildTransmissionsCsv([row({ daySummary: 'Chute ; sans gravité, dit "sans douleur"' })]);
    const value = cells(lines(csv)[1])[CSV_HEADER.indexOf('Résumé général')];
    assert.equal(value, '"Chute ', 'le point-virgule doit être entre guillemets, donc la découpe naïve le coupe ici');
    assert.ok(csv.includes('"Chute ; sans gravité, dit ""sans douleur"""'));
  });

  test('un texte sur plusieurs lignes ne casse pas le fichier', () => {
    const csv = buildTransmissionsCsv([row({ daySummary: 'Ligne une\nLigne deux' })]);
    assert.ok(csv.includes('"Ligne une\nLigne deux"'));
    // Deux lignes réelles : en-tête et donnée. Le saut est à l'intérieur des guillemets.
    assert.equal(csv.replace(/"[^"]*"/g, '""').replace(/^﻿/, '').trim().split('\r\n').length, 2);
  });

  test('une saisie commençant par = ou @ est neutralisée', () => {
    // Sans cela, Excel exécute la cellule comme une formule à l'ouverture.
    const csv = buildTransmissionsCsv([row({ daySummary: '=1+1', finalNotes: '@SUM(A1:A9)' })]);
    const values = cells(lines(csv)[1]);
    assert.equal(values[CSV_HEADER.indexOf('Résumé général')], "'=1+1");
    assert.equal(values[CSV_HEADER.indexOf('Autres remarques')], "'@SUM(A1:A9)");
  });

  test('un export vide garde son en-tête', () => {
    assert.equal(lines(buildTransmissionsCsv([])).length, 1);
  });

  test('le nom de fichier porte la personne et la période couverte', () => {
    const rows = [row(), { ...row(), entry_date: '2026-09-18' }];
    assert.equal(csvFilename('Maman Barakissa', rows), 'transmissions-maman-barakissa-2026-09-15_2026-09-18.csv');
    assert.equal(csvFilename('Aïssatou Koné', []), 'transmissions-aissatou-kone.csv');
  });
});
