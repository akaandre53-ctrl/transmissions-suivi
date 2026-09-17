import { ApiError, api } from './api.js';
import { hydrateIcons } from './icons.js';

/**
 * Éléments communs aux écrans connectés : illustration, navigation, compte.
 */

const ROLE_LABELS = { admin: 'Administration', aidant: 'Aidante', famille: 'Famille' };

/**
 * Paysage de l'en-tête : soleil, collines, une maison. Ses couleurs viennent
 * des variables CSS, il suit donc le mode sombre sans seconde version.
 */
export const LANDSCAPE = `
<svg viewBox="0 0 1200 260" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
  <!-- Le soleil se lève derrière la colline : placé bas, il n'est jamais rogné
       par le haut quand l'en-tête est moins haut que le dessin. -->
  <circle class="illu-sun" cx="960" cy="134" r="74"/>
  <circle class="illu-sun-core" cx="960" cy="134" r="46"/>
  <path class="illu-stroke" d="M904 92q9-8 18 0q9-8 18 0M952 70q7-6 14 0q7-6 14 0"/>
  <path class="illu-far" d="M0 170C150 120 290 128 430 150S720 196 880 164 1100 112 1200 132V260H0Z"/>
  <path class="illu-mid" d="M0 204C170 170 330 176 500 196S820 224 980 200 1140 170 1200 176V260H0Z"/>
  <!-- Tout le décor est à droite. Le texte occupe la gauche sur grand écran,
       et le cadrage est ancré à droite sur téléphone : à gauche, la maison
       touchait le titre ou se faisait rogner selon la largeur. -->
  <rect class="illu-house" x="1128" y="96" width="46" height="34" rx="3"/>
  <path class="illu-house" d="M1120 100l31-26 31 26"/>
  <rect class="illu-house" x="1145" y="111" width="12" height="19" rx="1.5"/>
  <path class="illu-stroke" d="M1086 168v-40"/>
  <path class="illu-leaf" d="M1086 150c-16-4-24-16-22-30 15 2 24 14 22 30Z"/>
  <path class="illu-leaf" d="M1086 138c14-6 20-18 16-30-14 4-20 16-16 30Z"/>
  <path class="illu-near" d="M0 232C200 212 380 218 600 232S980 252 1200 226V260H0Z"/>
</svg>`;

export function mountLandscape(root = document) {
  for (const slot of root.querySelectorAll('[data-landscape]')) slot.innerHTML = LANDSCAPE;
}

const initials = name => String(name || '')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0].toUpperCase())
  .join('') || '?';

export const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';

/**
 * Vérifie la session et prépare l'en-tête.
 * Renvoie l'utilisateur, ou null si une redirection vers la connexion a eu lieu.
 *
 * @param {object} options
 * @param {string[]} [options.roles]   rôles autorisés sur cette page
 * @param {() => boolean|Promise<boolean>} [options.beforeLogout]  false annule
 */
export async function setupChrome({ page, roles = null, beforeLogout = null } = {}) {
  mountLandscape();
  hydrateIcons();

  let me;
  try {
    me = await api.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      location.replace(`/login.html?suite=${encodeURIComponent(location.pathname)}`);
      return null;
    }
    throw error;
  }

  const user = me.user;
  if (roles && !roles.includes(user.role)) {
    location.replace(user.role === 'famille' ? '/historique.html' : '/');
    return null;
  }

  for (const slot of document.querySelectorAll('[data-user-name]')) slot.textContent = user.fullName;
  for (const slot of document.querySelectorAll('[data-user-first-name]')) slot.textContent = firstName(user.fullName);
  for (const slot of document.querySelectorAll('[data-user-role]')) slot.textContent = ROLE_LABELS[user.role] || '';
  for (const slot of document.querySelectorAll('[data-user-initials]')) slot.textContent = initials(user.fullName);

  // Chaque lien n'apparaît que pour les rôles qui peuvent s'en servir.
  for (const link of document.querySelectorAll('[data-nav]')) {
    const allowed = link.dataset.roles ? link.dataset.roles.split(' ') : null;
    link.hidden = Boolean(allowed && !allowed.includes(user.role));
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
  }

  for (const button of document.querySelectorAll('[data-logout]')) {
    button.addEventListener('click', async () => {
      if (beforeLogout && !(await beforeLogout())) return;
      await api.logout().catch(() => {});
      location.href = '/login.html';
    });
  }

  return user;
}

export function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

export function todayLabel() {
  return new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
