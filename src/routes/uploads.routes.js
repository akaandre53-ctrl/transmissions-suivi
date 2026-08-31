import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { MAX_IMAGES, MAX_IMAGE_BYTES, getField } from '../domain/schema.js';
import { validateClientRef } from '../domain/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { asyncHandler, requireUuidParam } from '../lib/http.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as images from '../repositories/images.repo.js';

export const uploadsRouter = Router();

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/**
 * Les photos sont envoyées UNE PAR REQUÊTE, avant la validation du formulaire.
 *
 * L'ancienne version empaquetait toutes les images en base64 dans le POST final.
 * Cinq photos suffisaient à dépasser la limite de 4,5 Mo des fonctions Vercel :
 * la requête était rejetée avant même d'atteindre le code, avec une réponse HTML
 * que le navigateur essayait de lire en JSON. C'était la cause principale des
 * « bugs » aléatoires du formulaire. Ici chaque requête pèse moins de 2 Mo.
 */
uploadsRouter.post(
  '/',
  requireRole('aidant'),
  rateLimit({ name: 'upload', limit: 120, windowSeconds: 60 * 60, keyFn: req => req.user.id }),
  asyncHandler(async (req, res) => {
    const clientRef = validateClientRef(req.body?.clientRef);
    const fieldName = String(req.body?.fieldName || '').trim();
    const field = getField(fieldName);
    if (!field || field.type !== 'photo') throw badRequest('Champ photo inconnu.');

    const match = DATA_URL.exec(String(req.body?.dataUrl || ''));
    if (!match) throw badRequest('Image illisible. Formats acceptés : JPEG, PNG ou WebP.');

    const [, mimeType, base64] = match;
    if (!ALLOWED_MIME.has(mimeType)) throw badRequest('Format d’image non accepté.');

    const content = Buffer.from(base64, 'base64');
    if (!content.length) throw badRequest('Image vide.');
    if (content.length > MAX_IMAGE_BYTES) {
      throw badRequest('Cette photo est trop lourde même après compression. Reprenez-la en qualité plus basse.');
    }

    const already = await images.countForClientRef(clientRef, req.user.id);
    if (already >= MAX_IMAGES) {
      throw badRequest(`${MAX_IMAGES} photos maximum par transmission. Supprimez-en une avant d’en ajouter.`);
    }

    const saved = await images.insert({
      ownerId: req.user.id,
      clientRef,
      fieldName,
      category: field.label,
      filename: String(req.body?.filename || 'photo.jpg').slice(0, 180),
      mimeType,
      content
    });

    res.status(201).json({
      ok: true,
      image: {
        id: saved.id,
        fieldName: saved.field_name,
        category: saved.category,
        filename: saved.filename,
        byteSize: saved.byte_size
      },
      remaining: MAX_IMAGES - (already + 1)
    });
  })
);

uploadsRouter.delete('/:id', requireUuidParam(), requireRole('aidant'), asyncHandler(async (req, res) => {
  const removed = await images.remove(req.params.id, req.user.id);
  if (!removed) throw notFound('Photo introuvable ou déjà rattachée à une transmission.');
  res.json({ ok: true });
}));

/**
 * Sert une photo déjà enregistrée (aperçu dans le formulaire et l'historique).
 * L'authentification est indispensable : ce sont des photos d'une personne
 * accompagnée, elles ne doivent jamais être accessibles avec la seule URL.
 */
uploadsRouter.get('/:id', requireUuidParam(), requireAuth, asyncHandler(async (req, res) => {
  const image = await images.findOne(req.params.id);
  if (!image) throw notFound('Photo introuvable.');
  res.setHeader('Content-Type', image.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(image.filename)}"`);
  res.send(image.content);
}));
