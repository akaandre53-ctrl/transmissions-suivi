/**
 * Brouillon local.
 *
 * Le README de l'application demande de remplir « au fil de la journée », mais
 * rien n'était sauvegardé : un téléphone qui se verrouille, un onglet fermé ou
 * une requête en échec faisaient perdre les cinquante champs déjà saisis.
 * Ici tout est écrit dans localStorage à chaque frappe (avec un délai court),
 * et rechargé au démarrage.
 *
 * La référence `clientRef` accompagne le brouillon : elle rend la soumission
 * idempotente côté serveur. Elle n'est renouvelée qu'après un envoi réussi.
 */

const KEY = 'transmission:brouillon:v2';
const PHONE_KEY = 'transmission:whatsapp';
const LEGACY_PHONE_KEY = 'transmission-maman-whatsapp';

const newRef = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const empty = () => ({
  clientRef: newRef(),
  values: {},
  photos: [],
  step: 0,
  updatedAt: Date.now()
});

export function loadDraft() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const draft = JSON.parse(raw);
    if (!draft?.clientRef || typeof draft.values !== 'object') return empty();

    // Un brouillon oublié depuis plus de trois jours porte sur une autre
    // journée : on repart à neuf plutôt que de transmettre des données périmées.
    if (Date.now() - (draft.updatedAt || 0) > 3 * 24 * 3600 * 1000) return empty();

    return {
      clientRef: draft.clientRef,
      values: draft.values || {},
      photos: Array.isArray(draft.photos) ? draft.photos : [],
      step: Number(draft.step) || 0,
      updatedAt: draft.updatedAt || Date.now()
    };
  } catch {
    return empty();
  }
}

let timer = null;

export function saveDraft(draft, { immediate = false } = {}) {
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
    } catch (error) {
      // Quota dépassé : on ne bloque pas la saisie, on prévient dans la console.
      console.warn('Brouillon non sauvegardé :', error?.name || error);
    }
  };
  clearTimeout(timer);
  if (immediate) write();
  else timer = setTimeout(write, 400);
}

export function clearDraft() {
  clearTimeout(timer);
  try {
    localStorage.removeItem(KEY);
  } catch { /* rien à faire */ }
}

export function rememberPhone(value) {
  try {
    localStorage.setItem(PHONE_KEY, value);
  } catch { /* rien à faire */ }
}

export function recallPhone() {
  try {
    return localStorage.getItem(PHONE_KEY) || localStorage.getItem(LEGACY_PHONE_KEY) || '';
  } catch {
    return '';
  }
}

export const newClientRef = newRef;
