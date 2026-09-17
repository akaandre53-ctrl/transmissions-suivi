import { api, fetchPdf } from './api.js';
import { setupChrome } from './chrome.js';
import { icon } from './icons.js';

const PAGE_SIZE = 20;

const $ = selector => document.querySelector(selector);
const elements = {
  timeline: $('#timeline'),
  loading: $('#loading'),
  empty: $('#empty'),
  emptyTitle: $('#empty-title'),
  emptyText: $('#empty-text'),
  error: $('#error'),
  more: $('#more'),
  filters: $('#filters'),
  heroMeta: $('#hero-meta')
};

const state = {
  user: null,
  people: [],
  filter: null,
  cursor: null,
  // Dernier groupe de mois affiché, pour prolonger la même liste au
  // chargement suivant plutôt que de répéter l'intitulé.
  lastMonth: null,
  lastList: null
};

/* Un état général inquiétant ou un événement signalé met la carte en avant. */
const STATE_TONE = {
  'Très bon': 'ok', Bon: 'ok', Moyen: 'warn', 'Fatiguée': 'warn', 'Préoccupant': 'danger'
};
const ATTENTION_TONE = { Information: 'brand', 'À surveiller': 'warn', Important: 'accent', Urgent: 'danger' };
const SHEET_LABEL = {
  synced: null,
  skipped: null,
  pending: ['warn', 'Copie Sheets en attente'],
  failed: ['danger', 'Copie Sheets échouée']
};

init().catch(error => showError(error.message || 'Chargement impossible.'));

async function init() {
  state.user = await setupChrome({ page: 'historique' });
  if (!state.user) return;

  const { beneficiaries } = await api.beneficiaries();
  state.people = beneficiaries;
  renderIntro();
  renderFilters();
  elements.more.addEventListener('click', () => load());
  await load({ reset: true });
}

function renderIntro() {
  const { role } = state.user;
  const meta = elements.heroMeta;
  meta.replaceChildren();

  const add = (iconName, text) => {
    const span = document.createElement('span');
    span.append(icon(iconName), text);
    meta.append(span);
  };

  if (role === 'aidant') add('notebook', 'Les transmissions que vous avez saisies');
  else if (role === 'admin') add('shield', 'Toutes les transmissions');
  else add('heart', 'Les journées des personnes que vous suivez');

  if (state.people.length) {
    add('users', state.people.map(person => person.fullName).join(', '));
  }
}

function renderFilters() {
  // Un filtre n'a de sens qu'à partir de deux personnes.
  if (state.people.length < 2) return;
  const options = [{ id: null, fullName: 'Toutes' }, ...state.people];
  elements.filters.replaceChildren(...options.map(person => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = person.fullName;
    chip.setAttribute('aria-pressed', String(person.id === state.filter));
    chip.addEventListener('click', () => {
      if (state.filter === person.id) return;
      state.filter = person.id;
      for (const other of elements.filters.children) other.setAttribute('aria-pressed', 'false');
      chip.setAttribute('aria-pressed', 'true');
      load({ reset: true });
    });
    return chip;
  }));
  elements.filters.hidden = false;
}

async function load({ reset = false } = {}) {
  if (reset) {
    state.cursor = null;
    state.lastMonth = null;
    state.lastList = null;
    elements.timeline.replaceChildren();
    elements.empty.hidden = true;
    elements.loading.hidden = false;
  }
  elements.more.disabled = true;
  elements.error.hidden = true;

  try {
    const params = { limit: PAGE_SIZE };
    if (state.cursor) params.before = state.cursor;
    if (state.filter) params.beneficiaryId = state.filter;
    const { items } = await api.list(params);

    elements.loading.hidden = true;
    if (!items.length && !state.cursor) {
      showEmpty();
      return;
    }
    for (const item of items) appendMoment(item);
    state.cursor = items.at(-1)?.createdAt || state.cursor;
    elements.more.hidden = items.length < PAGE_SIZE;
  } catch (error) {
    elements.loading.hidden = true;
    showError(error.message || 'Chargement impossible.');
  } finally {
    elements.more.disabled = false;
  }
}

function showEmpty() {
  elements.more.hidden = true;
  elements.empty.hidden = false;
  if (state.user.role === 'famille' && !state.people.length) {
    elements.emptyTitle.textContent = 'Aucune personne rattachée à votre compte';
    elements.emptyText.textContent = 'Demandez à l’administrateur de vous rattacher à la personne que vous suivez.';
  } else {
    elements.emptyTitle.textContent = 'Aucune transmission pour le moment';
    elements.emptyText.textContent = 'Les journées enregistrées apparaîtront ici.';
  }
}

function appendMoment(item) {
  const date = new Date(`${item.entryDate}T12:00:00Z`);
  const month = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  if (month !== state.lastMonth) {
    const heading = document.createElement('h2');
    heading.className = 'timeline-month';
    heading.textContent = month;
    const list = document.createElement('ol');
    list.className = 'timeline';
    elements.timeline.append(heading, list);
    state.lastMonth = month;
    state.lastList = list;
  }

  const attention = item.hasEvent === 'Oui' || item.generalState === 'Préoccupant';

  const li = document.createElement('li');
  li.className = `moment reveal${attention ? ' moment--attention' : ''}`;

  const dateBox = document.createElement('div');
  dateBox.className = 'moment__date';
  dateBox.setAttribute('aria-hidden', 'true');
  const day = document.createElement('span');
  day.className = 'moment__day';
  day.textContent = date.toLocaleDateString('fr-FR', { day: 'numeric', timeZone: 'UTC' });
  const weekday = document.createElement('span');
  weekday.className = 'moment__weekday';
  weekday.textContent = date.toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  dateBox.append(day, weekday);

  const card = document.createElement('article');
  card.className = 'moment__card';

  const top = document.createElement('div');
  top.className = 'moment__top';

  const identity = document.createElement('div');
  const person = document.createElement('h3');
  person.className = 'moment__person';
  person.textContent = item.personName;
  const meta = document.createElement('p');
  meta.className = 'moment__meta';
  const addMeta = (iconName, text) => {
    if (!text) return;
    const span = document.createElement('span');
    span.append(icon(iconName), text);
    meta.append(span);
  };
  addMeta('calendar', date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }));
  addMeta('clock', item.period);
  addMeta('user', item.authorName);
  if (item.photoCount) addMeta('camera', `${item.photoCount} photo${item.photoCount > 1 ? 's' : ''}`);
  identity.append(person, meta);

  const badges = document.createElement('div');
  badges.className = 'moment__badges';
  const addBadge = (tone, text, iconName) => {
    const badge = document.createElement('span');
    badge.className = `badge badge--${tone}`;
    if (iconName) badge.append(icon(iconName));
    badge.append(text);
    badges.append(badge);
  };
  if (item.generalState) addBadge(STATE_TONE[item.generalState] || 'brand', item.generalState, 'heart');
  if (item.hasEvent === 'Oui') addBadge(ATTENTION_TONE[item.attentionLevel] || 'accent', item.attentionLevel || 'Événement', 'bell');

  top.append(identity, badges);

  const summary = document.createElement('p');
  summary.className = 'moment__summary';
  summary.textContent = excerpt(item.summary);

  const actions = document.createElement('div');
  actions.className = 'moment__actions';
  const pdf = document.createElement('button');
  pdf.type = 'button';
  pdf.className = 'btn btn--ghost btn--small';
  pdf.append(icon('download'), 'PDF');
  pdf.setAttribute('aria-label', `Télécharger le PDF du ${date.toLocaleDateString('fr-FR', { timeZone: 'UTC' })} pour ${item.personName}`);
  pdf.addEventListener('click', () => downloadPdf(item, pdf));
  actions.append(pdf);

  const sheet = SHEET_LABEL[item.sheetStatus];
  // Le statut de la copie Sheets n'intéresse que l'admin.
  if (sheet && state.user.role === 'admin') {
    const badge = document.createElement('span');
    badge.className = `badge badge--${sheet[0]}`;
    badge.textContent = sheet[1];
    actions.append(badge);
  }

  card.append(top, summary, actions);
  li.append(dateBox, card);
  state.lastList.append(li);
}

/** Le résumé commence par « Transmission du … » : la date est déjà affichée. */
function excerpt(summary) {
  const blocks = String(summary || '').split('\n\n');
  const bilan = blocks.find(block => block.startsWith('Bilan de la journée'));
  const source = bilan || blocks.slice(1).join('\n');
  return source
    .split('\n')
    .filter(line => !/^(Bilan de la journée|Informations générales)$/.test(line))
    .map(line => line.replace(/^Résumé général : /, ''))
    .join(' · ');
}

async function downloadPdf(item, button) {
  const label = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(Object.assign(document.createElement('span'), { className: 'spinner' }), 'Préparation…');
  try {
    const file = await fetchPdf(`/api/transmissions/${item.id}/pdf`, `transmission-${item.entryDate}.pdf`);
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file] });
    } else {
      const url = URL.createObjectURL(file);
      const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) {
    if (error?.name !== 'AbortError') showError(error.message || 'PDF indisponible.');
  } finally {
    button.replaceChildren(...label);
    button.disabled = false;
  }
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
  elements.error.focus();
}
