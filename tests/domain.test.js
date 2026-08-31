import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { DATA_FIELDS, FIELDS, SHEET_HEADER, getField, isFieldActive } from '../src/domain/schema.js';
import { normalizePhone, validateClientRef, validateTransmission } from '../src/domain/validate.js';
import { buildSummary } from '../src/services/message.service.js';
import { renderTransmissionPdf, pdfFilename } from '../src/services/pdf.service.js';

const base = () => ({
  date: '2026-08-31',
  personName: 'Aïssatou Koné',
  caregiverName: 'Marie Kouassi',
  period: 'Journée complète',
  generalState: 'Bon',
  healthIssue: 'Non',
  medicationTaken: 'Oui, tous',
  hasExpense: 'Non',
  hasEvent: 'Non',
  daySummary: 'Journée calme, bon appétit.',
  recipientPhone: '+2250700000000'
});

describe('schéma', () => {
  test('chaque champ a un nom unique', () => {
    const names = FIELDS.map(field => field.name);
    assert.equal(new Set(names).size, names.length);
  });

  test('chaque showIf pointe vers un champ existant', () => {
    for (const field of FIELDS) {
      if (!field.showIf) continue;
      assert.ok(getField(field.showIf.field), `${field.name} dépend d'un champ inconnu`);
    }
  });

  test('chaque select propose des options', () => {
    for (const field of FIELDS) {
      if (field.type !== 'select') continue;
      assert.ok(Array.isArray(field.options) && field.options.length, `${field.name} n'a pas d'options`);
    }
  });

  test('un showIf ne référence que des valeurs réellement proposées', () => {
    for (const field of FIELDS) {
      if (!field.showIf) continue;
      const parent = getField(field.showIf.field);
      if (parent.type !== 'select') continue;
      for (const value of field.showIf.equals) {
        assert.ok(parent.options.includes(value),
          `${field.name} attend « ${value} » que ${parent.name} ne propose pas`);
      }
    }
  });

  test('l’en-tête Sheets couvre tous les champs de données', () => {
    assert.equal(SHEET_HEADER.length, DATA_FIELDS.length + 5);
  });

  test('la condition en cascade remonte jusqu’au parent', () => {
    // receiptPhoto dépend de receiptAvailable, lui-même dépendant de hasExpense.
    const values = { hasExpense: 'Non', receiptAvailable: 'Oui' };
    assert.equal(isFieldActive(getField('receiptPhoto'), values), false);
  });
});

describe('validation', () => {
  test('accepte une saisie minimale correcte', () => {
    const { errors } = validateTransmission(base());
    assert.deepEqual(errors, []);
  });

  test('efface les champs masqués au lieu de les enregistrer', () => {
    const input = { ...base(), hasExpense: 'Non', expenseItem: 'Pain', expenseAmount: '2000' };
    const { values, errors } = validateTransmission(input);
    assert.deepEqual(errors, []);
    assert.equal(values.expenseItem, '', 'les données fantômes doivent être effacées');
    assert.equal(values.expenseAmount, '');
  });

  test('n’exige pas un champ requis qui est masqué', () => {
    // healthIssueDetails est requis, mais seulement si healthIssue vaut « Oui ».
    const { errors } = validateTransmission({ ...base(), healthIssue: 'Non' });
    assert.deepEqual(errors, []);
  });

  test('exige un champ requis dès qu’il devient visible', () => {
    const { errors } = validateTransmission({ ...base(), healthIssue: 'Oui' });
    assert.ok(errors.some(error => error.field === 'healthIssueDetails'));
  });

  test('rejette un numéro qui n’est pas au format international', () => {
    const { errors } = validateTransmission({ ...base(), recipientPhone: '0700000000' });
    assert.ok(errors.some(error => error.field === 'recipientPhone'));
  });

  test('accepte un numéro saisi avec des espaces', () => {
    const { values, errors } = validateTransmission({ ...base(), recipientPhone: '+225 07 00 00 00 00' });
    assert.deepEqual(errors, []);
    assert.equal(values.recipientPhone, '+2250700000000');
  });

  test('rejette une valeur de liste inventée', () => {
    const { errors } = validateTransmission({ ...base(), generalState: 'Excellent' });
    assert.ok(errors.some(error => error.field === 'generalState'));
  });

  test('borne les constantes hors plage physiologique', () => {
    const { errors } = validateTransmission({ ...base(), pulseMorning: '900' });
    assert.ok(errors.some(error => error.field === 'pulseMorning'));
  });

  test('accepte une glycémie avec une virgule décimale', () => {
    const { values, errors } = validateTransmission({ ...base(), glucoseMorning: '1,25' });
    assert.deepEqual(errors, []);
    assert.equal(values.glucoseMorning, '1.25');
  });

  test('refuse une date dans le futur', () => {
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { errors } = validateTransmission({ ...base(), date: future });
    assert.ok(errors.some(error => error.field === 'date'));
  });

  test('rejette une charge utile qui n’est pas un objet', () => {
    assert.throws(() => validateTransmission([1, 2, 3]));
    assert.throws(() => validateTransmission(null));
  });

  test('normalizePhone retire la ponctuation', () => {
    assert.equal(normalizePhone('+225 (07) 00.00-00 00'), '+2250700000000');
  });

  test('validateClientRef refuse une référence trop courte ou exotique', () => {
    assert.throws(() => validateClientRef('abc'));
    assert.throws(() => validateClientRef('avec espace ici'));
    assert.equal(validateClientRef('a1B2c3D4e5F6'), 'a1B2c3D4e5F6');
  });
});

describe('résumé', () => {
  test('omet les sections entièrement vides', () => {
    const { values } = validateTransmission(base());
    const summary = buildSummary(values);
    assert.ok(summary.includes('Bilan de la journée'));
    assert.ok(!summary.includes('Constantes'), 'aucune constante saisie : la section doit disparaître');
  });

  test('n’expose pas le numéro du destinataire', () => {
    const { values } = validateTransmission(base());
    assert.ok(!buildSummary(values).includes('+2250700000000'));
  });

  test('ajoute l’unité des mesures', () => {
    const { values } = validateTransmission({ ...base(), weight: '62.5', pulseMorning: '74' });
    const summary = buildSummary(values);
    assert.ok(summary.includes('62.5 kg'));
    assert.ok(summary.includes('74 bpm'));
  });

  test('signale les photos jointes', () => {
    const { values } = validateTransmission(base());
    assert.ok(buildSummary(values, { photoCount: 3 }).includes('Photos jointes : 3'));
  });
});

describe('PDF', () => {
  test('produit un document valide malgré les accents', async () => {
    const { values } = validateTransmission({
      ...base(),
      healthIssue: 'Oui',
      healthIssueDetails: 'Légère gêne à l’épaule droite, apaisée après repos.',
      weight: '62.5'
    });
    const buffer = await renderTransmissionPdf({
      id: '3f7a1c2e-0000-0000-0000-000000000000',
      entry_date: '2026-08-31',
      created_at: new Date(),
      data: values,
      summary: buildSummary(values)
    });
    assert.ok(buffer.length > 1000, 'le PDF doit avoir du contenu');
    assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  test('une photo illisible n’empêche pas la génération', async () => {
    const { values } = validateTransmission(base());
    const buffer = await renderTransmissionPdf(
      { id: 'x', entry_date: '2026-08-31', created_at: new Date(), data: values, summary: '' },
      [{ category: 'Photo du déjeuner', mime_type: 'image/jpeg', content: Buffer.from('pas une image') }]
    );
    assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  test('les accents français sont encodés, pas perdus', async () => {
    // pdfkit sérialise le texte en chaînes hexadécimales <…> avec la police
    // Helvetica en WinAnsiEncoding : é=0xE9, è=0xE8, à=0xE0, ç=0xE7.
    // L'ancienne version retirait les accents de tous les libellés ; rien
    // ne l'imposait, et ce test empêche la régression inverse.
    const { values } = validateTransmission({
      ...base(), daySummary: 'Légère gêne à l’épaule, ça va mieux.'
    });
    const buffer = await renderTransmissionPdf(
      { id: 'x', entry_date: '2026-08-31', created_at: new Date(), data: values, summary: '' },
      [],
      { compress: false }
    );
    const hex = buffer.toString('latin1').match(/<[0-9a-f]+>/g)?.join('') || '';
    for (const [char, code] of [['é', 'e9'], ['è', 'e8'], ['à', 'e0'], ['ç', 'e7']]) {
      assert.ok(hex.includes(code), `le caractère ${char} (0x${code}) est absent du PDF`);
    }
  });

  test('le nom de fichier est débarrassé des accents', () => {
    assert.equal(
      pdfFilename({ personName: 'Aïssatou Koné-Diabaté', date: '2026-08-31' }),
      'transmission-aissatou-kone-diabate-2026-08-31.pdf'
    );
  });
});
