import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canReadImage, canReadTransmission, canWriteFor, isUuid } from '../src/domain/access.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const admin = { id: 'u-admin', role: 'admin' };
const aidante = { id: 'u-aidante', role: 'aidant' };
const autreAidante = { id: 'u-autre', role: 'aidant' };
const familleA = { id: 'u-famille-a', role: 'famille' };

const transmissionA = { author_id: 'u-aidante', beneficiary_id: A };
const transmissionB = { author_id: 'u-autre', beneficiary_id: B };

describe('lecture des transmissions', () => {
  test('l’admin lit tout', () => {
    assert.equal(canReadTransmission(admin, transmissionA), true);
    assert.equal(canReadTransmission(admin, transmissionB), true);
  });

  test('l’aidante lit ce qu’elle a saisi', () => {
    assert.equal(canReadTransmission(aidante, transmissionA, new Set([A])), true);
  });

  test('l’aidante ne lit pas la saisie d’une autre, même pour une personne qu’elle suit', () => {
    const saisieParAutre = { author_id: 'u-autre', beneficiary_id: A };
    assert.equal(canReadTransmission(aidante, saisieParAutre, new Set([A])), false);
  });

  test('la famille lit uniquement la personne qui lui est rattachée', () => {
    const liees = new Set([A]);
    assert.equal(canReadTransmission(familleA, transmissionA, liees), true);
    assert.equal(canReadTransmission(familleA, transmissionB, liees), false);
  });

  test('une famille sans rattachement ne voit rien', () => {
    // C'est l'état de chaque compte famille juste après la migration 002.
    assert.equal(canReadTransmission(familleA, transmissionA, new Set()), false);
  });

  test('une transmission sans personne n’est visible que de l’admin et de son auteur', () => {
    const orpheline = { author_id: 'u-aidante', beneficiary_id: null };
    assert.equal(canReadTransmission(familleA, orpheline, new Set([A])), false);
    assert.equal(canReadTransmission(aidante, orpheline), true);
    assert.equal(canReadTransmission(admin, orpheline), true);
  });

  test('un rôle inconnu ou une session absente ne lit rien', () => {
    assert.equal(canReadTransmission({ id: 'x', role: 'invite' }, transmissionA, new Set([A])), false);
    assert.equal(canReadTransmission(null, transmissionA), false);
  });
});

describe('saisie', () => {
  test('l’aidante saisit pour les personnes qui lui sont confiées', () => {
    assert.equal(canWriteFor(aidante, A, new Set([A])), true);
    assert.equal(canWriteFor(aidante, B, new Set([A])), false);
  });

  test('la famille ne saisit jamais', () => {
    assert.equal(canWriteFor(familleA, A, new Set([A])), false);
  });

  test('l’admin saisit pour tout le monde', () => {
    assert.equal(canWriteFor(admin, B), true);
  });

  test('un identifiant mal formé est refusé avant toute requête', () => {
    // Évite qu'un nom tapé à la main, envoyé par un ancien brouillon, fasse
    // échouer la requête SQL sur une conversion en uuid.
    assert.equal(canWriteFor(admin, 'Maman Barakissa'), false);
    assert.equal(isUuid('Maman Barakissa'), false);
    assert.equal(isUuid(A), true);
  });
});

describe('photos', () => {
  test('une photo pas encore rattachée n’est lisible que par son auteur', () => {
    const enCours = { owner_id: 'u-aidante', transmission_id: null };
    assert.equal(canReadImage(aidante, enCours, null), true);
    assert.equal(canReadImage(autreAidante, enCours, null), false);
    assert.equal(canReadImage(familleA, enCours, null, new Set([A])), false);
  });

  test('une photo rattachée suit la règle de sa transmission', () => {
    const photo = { owner_id: 'u-aidante', transmission_id: 't1' };
    assert.equal(canReadImage(familleA, photo, transmissionA, new Set([A])), true);
    assert.equal(canReadImage(familleA, photo, transmissionB, new Set([A])), false);
  });
});
