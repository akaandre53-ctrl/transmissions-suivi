/**
 * Brouillon local, un par compte.
 *
 * Tout est écrit dans localStorage à chaque frappe (avec un délai court) et
 * rechargé au démarrage : un téléphone qui se verrouille ou un onglet fermé ne
 * fait plus perdre la saisie.
 *
 * Le brouillon est rangé sous une clé propre au compte connecté. Auparavant la
 * clé était commune : deux personnes utilisant le même téléphone retrouvaient
 * chacune la saisie en cours de l'autre, données de santé comprises.
 *
 * La référence `clientRef` accompagne le brouillon : elle rend l'envoi
 * idempotent côté serveur. Elle n'est renouvelée qu'après un envoi réussi.
 */

const SHARED_DRAFT_KEY = 'transmission:brouillon:v2';
const LEGACY_PHONE_KEYS = ['transmission:whatsapp', 'transmission-maman-whatsapp'];
const MAX_AGE_MS = 3 * 24 * 3600 * 1000;

const newRef = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const empty = () => ({ clientRef: newRef(), values: {}, photos: [], step: 0, updatedAt: Date.now() });

const read = key => {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) {
    console.warn('Brouillon non sauvegardé :', error?.name || error);
  }
};
const remove = key => { try { localStorage.removeItem(key); } catch { /* rien à faire */ } };

const normalize = draft => {
  if (!draft?.clientRef || typeof draft.values !== 'object') return null;
  // Un brouillon oublié depuis plus de trois jours porte sur une autre journée.
  if (Date.now() - (draft.updatedAt || 0) > MAX_AGE_MS) return null;
  return {
    clientRef: draft.clientRef,
    values: draft.values || {},
    photos: Array.isArray(draft.photos) ? draft.photos : [],
    step: Number(draft.step) || 0,
    updatedAt: draft.updatedAt || Date.now()
  };
};

/**
 * @param {{ id: string, fullName: string }} user
 */
export function createDraftStore(user) {
  const draftKey = `transmission:brouillon:v3:${user.id}`;
  const phoneKey = `transmission:whatsapp:v3:${user.id}`;
  let timer = null;

  // Reprise de l'ancien brouillon partagé : il n'est rendu qu'à la personne qui
  // l'avait commencé (son nom figurait dans « Accompagnant(e) »), puis effacé
  // dans tous les cas pour ne plus traîner sur l'appareil.
  const shared = read(SHARED_DRAFT_KEY);
  if (shared) {
    const mine = String(shared.values?.caregiverName || '').trim() === String(user.fullName || '').trim();
    if (mine && !read(draftKey)) write(draftKey, shared);
    remove(SHARED_DRAFT_KEY);
  }

  return {
    load() {
      return normalize(read(draftKey)) || empty();
    },

    save(draft, { immediate = false } = {}) {
      const persist = () => write(draftKey, { ...draft, updatedAt: Date.now() });
      clearTimeout(timer);
      if (immediate) persist();
      else timer = setTimeout(persist, 400);
    },

    clear() {
      clearTimeout(timer);
      remove(draftKey);
    },

    hasContent() {
      const draft = normalize(read(draftKey));
      if (!draft) return false;
      const filled = Object.entries(draft.values)
        .filter(([name, value]) => !['date', 'caregiverName', 'recipientPhone'].includes(name) && String(value).trim());
      return filled.length > 2 || draft.photos.length > 0;
    },

    rememberPhone(value) {
      try { localStorage.setItem(phoneKey, value); } catch { /* rien à faire */ }
    },

    recallPhone() {
      try {
        const own = localStorage.getItem(phoneKey);
        if (own) return own;
        // Les anciennes clés datent de l'époque où un seul compte utilisait
        // l'appareil : on les reprend une fois, puis on les efface.
        for (const key of LEGACY_PHONE_KEYS) {
          const legacy = localStorage.getItem(key);
          if (legacy) {
            localStorage.setItem(phoneKey, legacy);
            LEGACY_PHONE_KEYS.forEach(remove);
            return legacy;
          }
        }
      } catch { /* rien à faire */ }
      return '';
    },

    newClientRef: newRef
  };
}
