import { api } from './api.js';

/**
 * Traitement des photos.
 *
 * Deux changements par rapport à l'ancienne version :
 *
 *  1. Chaque photo part dans SA PROPRE requête, dès sa sélection, au lieu
 *     d'être empaquetée en base64 dans l'envoi final. Cinq photos suffisaient
 *     à faire dépasser la limite de 4,5 Mo des fonctions serverless, et la
 *     requête était rejetée avant d'atteindre le code applicatif.
 *
 *  2. La compression vise une taille cible, pas seulement une dimension. On
 *     réduit la qualité tant que le résultat dépasse le budget, ce qui évite
 *     les refus après coup sur les photos très détaillées.
 */

const MAX_EDGE = 1280;
const TARGET_BYTES = 900 * 1024;
const FLOOR_QUALITY = 0.45;

const approxBytes = dataUrl => Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Ce fichier n’est pas une image lisible.'));
    };
    image.src = url;
  });
}

export async function compressImage(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Seules les images sont acceptées.');
  }
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.78;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (approxBytes(dataUrl) > TARGET_BYTES && quality > FLOOR_QUALITY) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return { dataUrl, bytes: approxBytes(dataUrl) };
}

/**
 * Compresse puis téléverse une photo.
 * @returns {{ id, fieldName, category, filename, dataUrl }}
 */
export async function uploadPhoto({ file, fieldName, clientRef }) {
  const { dataUrl } = await compressImage(file);
  const result = await api.uploadPhoto({
    clientRef,
    fieldName,
    filename: file.name || 'photo.jpg',
    dataUrl
  });
  return { ...result.image, dataUrl };
}
