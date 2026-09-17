/**
 * Icônes au trait, dessinées à partir de formes simples dans une grille de 24.
 * Construites en DOM, jamais par innerHTML. Toujours décoratives ici : le texte
 * voisin porte le sens, d'où aria-hidden.
 */

const SHAPES = {
  leaf: [['path', { d: 'M5 19c0-8 5.5-14 14-14 0 8.5-6 14-14 14Z' }], ['path', { d: 'M5 19l8-8' }]],
  heart: [['path', { d: 'M12 20s-7.5-4.6-7.5-10.2A4.1 4.1 0 0 1 12 7.3a4.1 4.1 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z' }]],
  pulse: [['path', { d: 'M3 12h4l2.5-6 5 12 2.5-6h4' }]],
  pill: [
    ['rect', { x: 3.5, y: 8.5, width: 17, height: 7, rx: 3.5, transform: 'rotate(-45 12 12)' }],
    ['path', { d: 'M9.5 9.5l5 5' }]
  ],
  meal: [['path', { d: 'M7 3v7M5 3v4.5a2 2 0 0 0 4 0V3M7 10v11' }], ['path', { d: 'M17 21V3c-2.2 1.6-3 4.4-3 7.5V13h3' }]],
  route: [
    ['circle', { cx: 6, cy: 18, r: 2 }], ['circle', { cx: 18, cy: 6, r: 2 }],
    ['path', { d: 'M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16' }]
  ],
  drop: [['path', { d: 'M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5Z' }]],
  moon: [['path', { d: 'M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10Z' }]],
  wallet: [
    ['rect', { x: 3, y: 6, width: 18, height: 13, rx: 2.5 }],
    ['path', { d: 'M3 10h18' }], ['circle', { cx: 16.5, cy: 14.5, r: 1 }]
  ],
  bell: [['path', { d: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z' }], ['path', { d: 'M10 21h4' }]],
  notebook: [['rect', { x: 5, y: 3, width: 14, height: 18, rx: 2.5 }], ['path', { d: 'M9 8h6M9 12h6M9 16h3.5' }]],
  share: [
    ['circle', { cx: 18, cy: 5.5, r: 2.5 }], ['circle', { cx: 6, cy: 12, r: 2.5 }], ['circle', { cx: 18, cy: 18.5, r: 2.5 }],
    ['path', { d: 'M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1' }]
  ],
  calendar: [['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 2.5 }], ['path', { d: 'M3.5 10h17M8 3v4M16 3v4' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7.5V12l3 2' }]],
  camera: [
    ['path', { d: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2.5h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z' }],
    ['circle', { cx: 12, cy: 13, r: 3.5 }]
  ],
  file: [['path', { d: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z' }], ['path', { d: 'M14 3v5h5M9 13h6M9 17h4' }]],
  download: [['path', { d: 'M12 4v11M7 10.5l5 5 5-5M5 20h14' }]],
  chat: [['path', { d: 'M4.5 19.5l1.2-3.6A8 8 0 1 1 9 19.2l-4.5.3Z' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  close: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7' }]],
  arrowLeft: [['path', { d: 'M19 12H5M11 6l-6 6 6 6' }]],
  arrowRight: [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4.5 20.5a7.5 7.5 0 0 1 15 0' }]],
  users: [
    ['circle', { cx: 9, cy: 8.5, r: 3.5 }], ['path', { d: 'M2.5 20a6.5 6.5 0 0 1 13 0' }],
    ['circle', { cx: 17, cy: 9.5, r: 2.5 }], ['path', { d: 'M16.5 14.5a5 5 0 0 1 5 5.5' }]
  ],
  logout: [['path', { d: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4' }]],
  shield: [['path', { d: 'M12 3l7.5 3v6c0 4.8-3.3 7.8-7.5 9-4.2-1.2-7.5-4.2-7.5-9V6L12 3Z' }], ['path', { d: 'M9 12l2 2 4-4' }]],
  alert: [['path', { d: 'M12 4 2.8 19.5h18.4L12 4Z' }], ['path', { d: 'M12 10v4M12 17h.01' }]],
  info: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 11v5M12 8h.01' }]],
  eye: [['path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  eyeOff: [['path', { d: 'M3 3l18 18M10.6 5.6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.1 3.9M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2' }]],
  external: [['path', { d: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2.5 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]]
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, { className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attributes] of SHAPES[name] || SHAPES.info) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    svg.append(element);
  }
  return svg;
}

/** Remplace chaque <span data-icon="nom"> du document par son icône. */
export function hydrateIcons(root = document) {
  for (const slot of root.querySelectorAll('[data-icon]')) {
    slot.replaceWith(icon(slot.dataset.icon, { className: slot.className }));
  }
}

/** Icône associée à chaque section du formulaire. */
export const SECTION_ICONS = {
  general: 'user',
  health: 'heart',
  vitals: 'pulse',
  medication: 'pill',
  nutrition: 'meal',
  mobility: 'route',
  care: 'drop',
  wellbeing: 'moon',
  expense: 'wallet',
  events: 'bell',
  summary: 'notebook',
  share: 'share'
};
