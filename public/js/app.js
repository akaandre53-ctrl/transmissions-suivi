import { ApiError, api, fetchPdf } from './api.js';
import { copyText, escapeHtml, firstName, saveFile, setupChrome, todayLabel } from './chrome.js';
import { createDraftStore } from './draft.js';
import {
  clearAllErrors, clearFieldError, createField, isFieldActive,
  renderErrorSummary, showFieldError, validateFields
} from './form.js';
import { SECTION_ICONS, icon } from './icons.js';
import { uploadPhoto } from './photos.js';

/* Regroupement des sections en étapes. Douze écrans seraient trop nombreux ;
   sept restent parcourables au pouce sans noyer l'aidante. */
const STEPS = [
  { title: 'Général et santé', sections: ['general', 'health'] },
  { title: 'Constantes', sections: ['vitals'] },
  { title: 'Médicaments', sections: ['medication'] },
  { title: 'Alimentation', sections: ['nutrition'] },
  { title: 'Activités et soins', sections: ['mobility', 'care', 'wellbeing'] },
  { title: 'Dépenses et événements', sections: ['expense', 'events'] },
  { title: 'Bilan et partage', sections: ['summary', 'share'] }
];

const $ = selector => document.querySelector(selector);

const state = {
  schema: null,
  byName: new Map(),
  fields: [],
  beneficiaries: [],
  store: null,
  draft: null,
  step: 0,
  submitting: false,
  user: null
};

const elements = {
  app: $('#app'),
  loading: $('#loading'),
  steps: $('#steps'),
  summary: $('#error-summary'),
  status: $('#status'),
  dots: $('#progress-dots'),
  progress: $('#progress'),
  progressCount: $('#progress-count'),
  progressTitle: $('#progress-title'),
  back: $('#back'),
  next: $('#next'),
  submit: $('#submit'),
  actions: $('#actions'),
  done: $('#done'),
  noAccess: $('#no-access')
};

/* ------------------------------------------------------------- démarrage */

init().catch(error => {
  elements.loading.innerHTML =
    `<div class="alert alert--error"><p>${escapeHtml(error.message || 'Chargement impossible.')}</p></div>`;
});

async function init() {
  const user = await setupChrome({
    page: 'saisie',
    roles: ['aidant', 'admin'],
    beforeLogout: confirmLogout
  });
  if (!user) return;
  state.user = user;
  state.store = createDraftStore(user);
  state.draft = state.store.load();

  $('#greeting-name').textContent = firstName(user.fullName);
  $('#today').textContent = todayLabel();

  const [schema, people] = await Promise.all([api.schema(), api.beneficiaries()]);
  state.schema = schema;
  state.beneficiaries = people.beneficiaries;
  state.fields = schema.sections.flatMap(section =>
    section.fields.map(field => ({ ...field, sectionId: section.id }))
  );
  state.byName = new Map(state.fields.map(field => [field.name, field]));

  elements.loading.hidden = true;

  // Sans personne confiée, le formulaire ne peut pas aboutir : on le dit tout
  // de suite plutôt qu'après sept étapes de saisie.
  if (!state.beneficiaries.length) {
    elements.noAccess.hidden = false;
    return;
  }

  renderSteps();
  hydrate();
  bindEvents();

  state.step = Math.min(state.draft.step || 0, STEPS.length - 1);
  goToStep(state.step, { focus: false });
  elements.app.hidden = false;

  if (state.store.hasContent()) setStatus('Votre saisie en cours a été retrouvée.', 'saved');
}

async function confirmLogout() {
  if (!state.store?.hasContent()) return true;
  const leave = window.confirm(
    'Une saisie est en cours. Elle sera effacée de cet appareil si vous vous déconnectez. Continuer ?'
  );
  if (leave) state.store.clear();
  return leave;
}

/* ------------------------------------------------------------------ rendu */

function renderSteps() {
  const sections = new Map(state.schema.sections.map(section => [section.id, section]));

  elements.dots.style.setProperty('--count', STEPS.length);
  elements.dots.replaceChildren(...STEPS.map(() => document.createElement('li')));

  STEPS.forEach((step, index) => {
    const container = document.createElement('section');
    container.className = 'step';
    container.dataset.step = index;
    container.hidden = true;

    step.sections.forEach((sectionId, position) => {
      const section = sections.get(sectionId);
      if (!section) return;

      const card = document.createElement('div');
      card.className = 'card reveal';

      const head = document.createElement('div');
      head.className = 'card__head';

      const badge = document.createElement('span');
      badge.className = `card__icon${['events', 'expense'].includes(sectionId) ? ' card__icon--accent' : ''}`;
      badge.append(icon(SECTION_ICONS[sectionId] || 'notebook'));

      const titles = document.createElement('div');
      const heading = document.createElement('h2');
      heading.className = 'card__title';
      heading.textContent = section.title;
      // Le premier titre de l'étape reçoit le focus au changement d'étape.
      if (position === 0) heading.tabIndex = -1;
      titles.append(heading);
      if (section.hint) {
        const hint = document.createElement('p');
        hint.className = 'card__hint';
        hint.textContent = section.hint;
        titles.append(hint);
      }

      head.append(badge, titles);
      card.append(head);

      const grid = document.createElement('div');
      grid.className = 'grid grid--pair';
      for (const field of section.fields) {
        grid.append(field.type === 'photo'
          ? createPhotoField(field)
          : createField(field, { beneficiaries: state.beneficiaries }));
      }
      card.append(grid);
      container.append(card);
    });

    elements.steps.append(container);
  });
}

function createPhotoField(field) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field field--wide';
  wrapper.dataset.field = field.name;

  const label = document.createElement('p');
  label.className = 'field__label';
  label.textContent = field.label;
  wrapper.append(label);

  if (field.help) {
    const help = document.createElement('p');
    help.className = 'field__help';
    help.textContent = field.help;
    wrapper.append(help);
  }

  const photos = document.createElement('div');
  photos.className = 'photos';

  const list = document.createElement('ul');
  list.className = 'photo-list';
  list.dataset.photoList = field.name;

  const drop = document.createElement('label');
  drop.className = 'photo-drop';
  drop.append(icon('camera'), field.multiple ? 'Ajouter des photos' : 'Ajouter une photo');

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (field.multiple) input.multiple = true;
  input.dataset.photoInput = field.name;
  input.setAttribute('aria-label', field.label);
  drop.append(input);

  photos.append(list, drop);
  wrapper.append(photos);
  return wrapper;
}

/* ------------------------------------------------------------- hydratation */

function hydrate() {
  const values = state.draft.values;

  if (!values.date) values.date = new Date().toLocaleDateString('sv-SE');
  if (!values.recipientPhone) values.recipientPhone = state.store.recallPhone();
  if (!values.caregiverName) values.caregiverName = state.user.fullName;

  for (const [name, value] of Object.entries(values)) {
    const control = elements.steps.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!control) continue;
    // Un ancien brouillon peut contenir un nom tapé à la main à la place d'un
    // identifiant : on ne l'impose pas à la liste, qui garde sa valeur par défaut.
    if (control.tagName === 'SELECT' && ![...control.options].some(option => option.value === value)) continue;
    control.value = value;
  }

  for (const photo of state.draft.photos) appendPhoto(photo, { pending: false });

  applyConditions();
}

/** Recalcule l'affichage des champs conditionnels. */
function applyConditions() {
  const values = collectValues();
  for (const field of state.fields) {
    const wrapper = elements.steps.querySelector(`.field[data-field="${CSS.escape(field.name)}"]`);
    if (!wrapper) continue;
    const active = isFieldActive(field, values, state.byName);
    wrapper.hidden = !active;
    if (!active) clearFieldError(elements.steps, field.name);
  }
}

function collectValues() {
  const values = {};
  for (const control of elements.steps.querySelectorAll('input[name], select[name], textarea[name]')) {
    values[control.name] = control.value;
  }
  return values;
}

/* ---------------------------------------------------------------- événements */

function bindEvents() {
  elements.steps.addEventListener('input', event => {
    const control = event.target;
    if (!control.name) return;
    clearFieldError(elements.steps, control.name);
    persist();
  });

  // La validation à la sortie du champ signale l'erreur au bon moment :
  // ni à chaque frappe (agaçant), ni seulement à l'envoi (trop tard).
  elements.steps.addEventListener('blur', event => {
    const control = event.target;
    if (!control.name) return;
    const field = state.byName.get(control.name);
    if (!field) return;
    const values = collectValues();
    if (!isFieldActive(field, values, state.byName)) return;
    const [error] = validateFields([field], values, state.byName);
    if (error) showFieldError(elements.steps, error.field, error.message);
  }, true);

  elements.steps.addEventListener('change', event => {
    const name = event.target.dataset.photoInput;
    if (name) {
      handlePhotoSelection(event.target, name);
      return;
    }
    applyConditions();
    persist();
  });

  elements.steps.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-photo]');
    if (button) removePhoto(button.dataset.removePhoto);
  });

  elements.back.addEventListener('click', () => goToStep(state.step - 1));
  elements.next.addEventListener('click', () => {
    if (validateStep(state.step)) goToStep(state.step + 1);
  });
  elements.submit.addEventListener('click', submit);

  // Dernier filet : prévient avant de fermer un onglet avec une saisie en cours.
  window.addEventListener('beforeunload', event => {
    if (state.submitting || !state.store.hasContent()) return;
    event.preventDefault();
  });
}

function persist() {
  state.draft.values = collectValues();
  state.draft.step = state.step;
  state.store.save(state.draft);
  setStatus('Enregistré sur cet appareil.', 'saved');
}

/* ------------------------------------------------------------- navigation */

function goToStep(index, { focus = true } = {}) {
  state.step = Math.max(0, Math.min(index, STEPS.length - 1));

  for (const step of elements.steps.children) {
    step.hidden = Number(step.dataset.step) !== state.step;
  }

  [...elements.dots.children].forEach((dot, position) => {
    dot.dataset.state = position < state.step ? 'done' : position === state.step ? 'current' : 'todo';
  });

  const human = state.step + 1;
  elements.progressCount.textContent = `Étape ${human} sur ${STEPS.length}`;
  elements.progressTitle.textContent = STEPS[state.step].title;
  elements.dots.setAttribute('aria-valuenow', String(human));
  elements.dots.setAttribute('aria-valuetext', `Étape ${human} sur ${STEPS.length} : ${STEPS[state.step].title}`);

  elements.back.hidden = state.step === 0;
  elements.next.hidden = state.step === STEPS.length - 1;
  elements.submit.hidden = state.step !== STEPS.length - 1;

  elements.summary.hidden = true;
  state.draft.step = state.step;
  state.store.save(state.draft);

  if (focus) {
    elements.progress.scrollIntoView({ block: 'start', behavior: 'instant' });
    elements.steps.querySelector(`[data-step="${state.step}"] h2[tabindex]`)?.focus({ preventScroll: true });
  }
}

function stepFields(index) {
  const ids = new Set(STEPS[index].sections);
  return state.fields.filter(field => ids.has(field.sectionId));
}

function validateStep(index) {
  clearAllErrors(elements.steps);
  const values = collectValues();
  const errors = validateFields(stepFields(index), values, state.byName);
  for (const error of errors) showFieldError(elements.steps, error.field, error.message);
  renderErrorSummary(elements.summary, errors, focusField);
  return errors.length === 0;
}

function focusField(name) {
  const wrapper = elements.steps.querySelector(`.field[data-field="${CSS.escape(name)}"]`);
  const step = wrapper?.closest('.step');
  if (step && Number(step.dataset.step) !== state.step) goToStep(Number(step.dataset.step), { focus: false });
  const control = wrapper?.querySelector('input, select, textarea');
  control?.focus();
  control?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ------------------------------------------------------------------ photos */

async function handlePhotoSelection(input, fieldName) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;

  const remaining = state.schema.maxImages - state.draft.photos.length;
  if (remaining <= 0) {
    setStatus(`${state.schema.maxImages} photos maximum. Retirez-en une avant d’en ajouter.`, 'error');
    return;
  }

  // Le contrôle du total se fait AVANT l'envoi, pas après avoir tout téléversé.
  for (const file of files.slice(0, remaining)) {
    const placeholder = appendPhoto(
      { id: `attente-${Math.random().toString(36).slice(2)}`, fieldName, filename: file.name },
      { pending: true }
    );
    try {
      const photo = await uploadPhoto({ file, fieldName, clientRef: state.draft.clientRef });
      state.draft.photos.push({ id: photo.id, fieldName, category: photo.category, filename: photo.filename });
      state.store.save(state.draft, { immediate: true });
      placeholder.replaceWith(buildPhotoItem(photo, { pending: false }));
      setStatus('Photo ajoutée.', 'saved');
    } catch (error) {
      placeholder.remove();
      setStatus(error.message || 'Photo non envoyée.', 'error');
    }
  }

  if (files.length > remaining) {
    setStatus(`Seules ${remaining} photo(s) supplémentaires étaient possibles.`, 'error');
  }
}

function appendPhoto(photo, options) {
  const list = elements.steps.querySelector(`[data-photo-list="${CSS.escape(photo.fieldName)}"]`);
  if (!list) return document.createElement('li');
  const item = buildPhotoItem(photo, options);
  list.append(item);
  return item;
}

function buildPhotoItem(photo, { pending }) {
  const item = document.createElement('li');
  item.className = `photo${pending ? ' photo--pending' : ''}`;
  item.dataset.photoId = photo.id;

  const image = document.createElement('img');
  image.alt = photo.category || photo.filename || 'Photo de la journée';
  image.loading = 'lazy';
  if (photo.dataUrl || !pending) image.src = photo.dataUrl || `/api/uploads/${photo.id}`;
  item.append(image);

  if (pending) {
    const label = document.createElement('span');
    label.className = 'photo__state';
    label.textContent = 'Envoi…';
    item.append(label);
  } else {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'photo__remove';
    remove.dataset.removePhoto = photo.id;
    remove.setAttribute('aria-label', `Retirer la photo ${photo.filename || ''}`.trim());
    remove.append(icon('close'));
    item.append(remove);
  }
  return item;
}

async function removePhoto(id) {
  elements.steps.querySelector(`[data-photo-id="${CSS.escape(id)}"]`)?.remove();
  state.draft.photos = state.draft.photos.filter(photo => photo.id !== id);
  state.store.save(state.draft, { immediate: true });
  // La photo disparaît de l'écran quoi qu'il arrive ; les orphelines sont
  // purgées côté serveur par la tâche d'entretien.
  await api.deletePhoto(id).catch(() => {});
}

/* ------------------------------------------------------------------- envoi */

async function submit() {
  if (state.submitting) return;

  clearAllErrors(elements.steps);
  const values = collectValues();
  const errors = validateFields(state.fields, values, state.byName);
  if (errors.length) {
    for (const error of errors) showFieldError(elements.steps, error.field, error.message);
    const first = state.fields.find(field => field.name === errors[0].field);
    const stepIndex = STEPS.findIndex(step => step.sections.includes(first.sectionId));
    if (stepIndex >= 0 && stepIndex !== state.step) goToStep(stepIndex, { focus: false });
    renderErrorSummary(elements.summary, errors, focusField);
    return;
  }

  state.submitting = true;
  elements.submit.disabled = true;
  elements.back.disabled = true;
  setStatus('Enregistrement en cours…', 'busy');

  try {
    const result = await api.submit({
      clientRef: state.draft.clientRef,
      values,
      imageIds: state.draft.photos.map(photo => photo.id)
    });

    state.store.rememberPhone(values.recipientPhone.replace(/[\s().-]/g, ''));
    // À partir d'ici l'enregistrement est acquis. Le PDF et WhatsApp peuvent
    // échouer sans remettre les données en cause.
    showDone(result, values);
  } catch (error) {
    state.submitting = false;
    elements.submit.disabled = false;
    elements.back.disabled = false;

    if (error instanceof ApiError && Array.isArray(error.details)) {
      for (const detail of error.details) showFieldError(elements.steps, detail.field, detail.message);
      renderErrorSummary(elements.summary, error.details, focusField);
      setStatus('Corrigez les champs signalés.', 'error');
      return;
    }
    setStatus(error.message || 'Enregistrement impossible.', 'error');
  }
}

function showDone(result, values) {
  elements.steps.hidden = true;
  elements.actions.hidden = true;
  elements.summary.hidden = true;
  elements.progress.hidden = true;
  elements.status.textContent = '';

  const phone = values.recipientPhone.replace(/[\s().-]/g, '');
  const greeting = result.greeting || 'Bonjour, veuillez trouver ci-joint la transmission du jour.';
  const person = state.beneficiaries.find(entry => entry.id === values.personName)?.fullName || '';
  const sheetPending = !['synced', 'skipped'].includes(result.sheet?.status);

  elements.done.innerHTML = `
    <div class="card done reveal">
      <div class="done__icon"></div>
      <p class="eyebrow">Transmission enregistrée</p>
      <h2>${escapeHtml(result.alreadySaved ? 'Déjà enregistrée' : 'Merci, c’est enregistré')}</h2>
      <p class="card__hint">${escapeHtml(
        result.alreadySaved
          ? 'Cette transmission avait déjà été envoyée : aucune ligne en double n’a été créée.'
          : `La journée${person ? ` de ${person}` : ''} est enregistrée. Il ne reste qu’à partager le PDF avec la famille.`
      )}</p>
      ${sheetPending ? `
        <div class="alert alert--warn">
          <p>La copie vers Google Sheets n’a pas encore abouti. L’enregistrement est bien fait et la copie sera reprise automatiquement.</p>
        </div>` : ''}
      <div class="done__actions">
        <button type="button" class="btn btn--primary" id="send-whatsapp"></button>
        <button type="button" class="btn btn--ghost" id="get-pdf"></button>
        <button type="button" class="btn btn--quiet" id="restart">Nouvelle transmission</button>
      </div>
      <p class="status" id="done-status" role="status" aria-live="polite"></p>
    </div>`;

  elements.done.querySelector('.done__icon').append(icon('check'));
  $('#send-whatsapp').append(icon('chat'), 'Envoyer sur WhatsApp');
  $('#get-pdf').append(icon('download'), 'Télécharger le PDF seulement');
  elements.done.hidden = false;
  elements.done.focus();

  const doneStatus = $('#done-status');
  const filename = `transmission-${values.date}.pdf`;

  const setDoneStatus = (message, kind = '') => {
    doneStatus.className = `status${kind ? ` status--${kind}` : ''}`;
    doneStatus.textContent = message;
  };

  const withButton = (id, action) => $(`#${id}`).addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      setDoneStatus(
        error?.name === 'AbortError' ? 'Envoi annulé, la transmission reste enregistrée.' : (error.message || 'Action impossible.'),
        error?.name === 'AbortError' ? '' : 'error'
      );
    } finally {
      button.disabled = false;
    }
  });

  /**
   * Un seul geste : le PDF part avec le message vers WhatsApp, où l'aidante
   * choisit le ou les contacts. Le partage natif du téléphone ne demande pas
   * de télécharger d'abord puis de joindre à la main.
   */
  withButton('send-whatsapp', async () => {
    setDoneStatus('Préparation du PDF…', '');
    const file = await fetchPdf(result.pdfUrl, filename);

    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      // WhatsApp ne reprend pas toujours le texte qui accompagne un document :
      // on le met dans le presse-papiers pour qu'il suffise de le coller.
      const copied = await copyText(greeting);
      await navigator.share({ files: [file], text: greeting, title: 'Transmission du jour' });
      setDoneStatus(
        copied
          ? 'Choisissez WhatsApp puis le contact. Si le message n’apparaît pas, collez-le, il est copié.'
          : 'Choisissez WhatsApp puis le contact.',
        'saved'
      );
      return;
    }

    // Ordinateur : le partage natif n'existe pas. On enchaîne les deux gestes
    // au lieu de les laisser à l'utilisateur.
    saveFile(file);
    await copyText(greeting);
    window.open(
      `https://wa.me/${encodeURIComponent(phone.slice(1))}?text=${encodeURIComponent(greeting)}`,
      '_blank',
      'noopener'
    );
    setDoneStatus('WhatsApp est ouvert avec le message. Joignez le PDF qui vient d’être téléchargé.', 'saved');
  });

  withButton('get-pdf', async () => {
    setDoneStatus('Préparation du PDF…', '');
    saveFile(await fetchPdf(result.pdfUrl, filename));
    setDoneStatus('PDF téléchargé.', 'saved');
  });

  $('#restart').addEventListener('click', () => {
    state.store.clear();
    location.reload();
  });

  // Le brouillon n'est effacé qu'une fois la transmission acquise côté serveur.
  state.store.clear();
  state.draft = { clientRef: state.store.newClientRef(), values: {}, photos: [], step: 0 };
}

/* --------------------------------------------------------------- utilitaires */

let statusTimer = null;

function setStatus(message, kind = '') {
  elements.status.className = `status${kind && kind !== 'busy' ? ` status--${kind}` : ''}`;
  elements.status.replaceChildren();
  if (kind === 'busy') {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    elements.status.append(spinner);
  } else if (kind === 'saved') {
    elements.status.append(icon('check'));
  }
  elements.status.append(message);
  clearTimeout(statusTimer);
  if (kind === 'saved') statusTimer = setTimeout(() => elements.status.replaceChildren(), 2600);
}
