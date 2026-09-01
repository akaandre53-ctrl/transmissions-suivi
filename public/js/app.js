import { ApiError, api, fetchPdf } from './api.js';
import { clearDraft, loadDraft, newClientRef, recallPhone, rememberPhone, saveDraft } from './draft.js';
import {
  clearAllErrors, clearFieldError, createField, isFieldActive,
  renderErrorSummary, showFieldError, validateFields
} from './form.js';
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
  draft: loadDraft(),
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
  progressBar: $('#progress-bar'),
  progressStep: $('#progress-step'),
  progressTitle: $('#progress-title'),
  back: $('#back'),
  next: $('#next'),
  submit: $('#submit'),
  actions: $('#actions'),
  done: $('#done'),
  userName: $('#user-name'),
  logout: $('#logout')
};

/* ------------------------------------------------------------- démarrage */

init().catch(error => {
  elements.loading.innerHTML =
    `<p class="alert alert--error">${escapeHtml(error.message || 'Chargement impossible.')}</p>`;
});

async function init() {
  const me = await api.me().catch(error => {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  });
  if (!me?.user) {
    location.replace(`/login.html?suite=${encodeURIComponent(location.pathname)}`);
    return;
  }
  state.user = me.user;
  elements.userName.textContent = me.user.fullName;

  if (me.user.role !== 'aidant' && me.user.role !== 'admin') {
    // La famille consulte l'historique mais ne saisit pas de transmission.
    location.replace('/historique.html');
    return;
  }

  const schema = await api.schema();
  state.schema = schema;
  state.fields = schema.sections.flatMap(section =>
    section.fields.map(field => ({ ...field, sectionId: section.id }))
  );
  state.byName = new Map(state.fields.map(field => [field.name, field]));

  renderSteps();
  hydrate();
  bindEvents();

  state.step = Math.min(state.draft.step || 0, STEPS.length - 1);
  goToStep(state.step, { focus: false });

  elements.loading.hidden = true;
  elements.app.hidden = false;

  if (Object.keys(state.draft.values).length > 3) {
    setStatus('Brouillon du jour restauré.', 'saved');
  }
}

/* ------------------------------------------------------------------ rendu */

function renderSteps() {
  const sections = new Map(state.schema.sections.map(section => [section.id, section]));

  STEPS.forEach((step, index) => {
    const container = document.createElement('section');
    container.className = 'step';
    container.dataset.step = index;
    container.hidden = true;
    container.setAttribute('aria-labelledby', `etape-${index}-titre`);

    for (const sectionId of step.sections) {
      const section = sections.get(sectionId);
      if (!section) continue;

      const card = document.createElement('div');
      card.className = 'card';

      const head = document.createElement('div');
      head.className = 'card__head';
      const heading = document.createElement('h2');
      heading.id = `etape-${index}-titre`;
      heading.textContent = section.title;
      head.append(heading);
      if (section.hint) {
        const hint = document.createElement('p');
        hint.className = 'card__hint';
        hint.textContent = section.hint;
        head.append(hint);
      }
      card.append(head);

      const grid = document.createElement('div');
      grid.className = 'grid grid--pair';
      for (const field of section.fields) {
        grid.append(field.type === 'photo' ? createPhotoField(field) : createField(field));
      }
      card.append(grid);
      container.append(card);
    }
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
  drop.append(icon('M12 5v14M5 12h14'), field.multiple ? 'Ajouter des photos' : 'Ajouter une photo');

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (field.multiple) input.multiple = true;
  input.dataset.photoInput = field.name;
  drop.append(input);

  photos.append(list, drop);
  wrapper.append(photos);
  return wrapper;
}

function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  element.setAttribute('d', path);
  svg.append(element);
  return svg;
}

/* ------------------------------------------------------------- hydratation */

function hydrate() {
  const values = state.draft.values;

  if (!values.date) values.date = new Date().toLocaleDateString('sv-SE');
  if (!values.recipientPhone) values.recipientPhone = recallPhone();
  if (!values.caregiverName) values.caregiverName = state.user.fullName;

  for (const [name, value] of Object.entries(values)) {
    const control = elements.steps.querySelector(`[name="${CSS.escape(name)}"]`);
    if (control) control.value = value;
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
    if (event.target.dataset.photoInput) return;
    applyConditions();
    persist();
  });

  elements.steps.addEventListener('change', event => {
    const name = event.target.dataset.photoInput;
    if (name) handlePhotoSelection(event.target, name);
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
  elements.logout.addEventListener('click', async () => {
    await api.logout().catch(() => {});
    location.href = '/login.html';
  });

  // Dernier filet : prévient avant de fermer un onglet avec une saisie en cours.
  window.addEventListener('beforeunload', event => {
    if (state.submitting || Object.keys(state.draft.values).length < 4) return;
    event.preventDefault();
  });
}

function persist() {
  state.draft.values = collectValues();
  state.draft.step = state.step;
  saveDraft(state.draft);
  setStatus('Brouillon enregistré sur cet appareil.', 'saved');
}

/* ------------------------------------------------------------- navigation */

function goToStep(index, { focus = true } = {}) {
  state.step = Math.max(0, Math.min(index, STEPS.length - 1));

  for (const step of elements.steps.children) {
    step.hidden = Number(step.dataset.step) !== state.step;
  }

  const human = state.step + 1;
  elements.progressStep.textContent = `Étape ${human} sur ${STEPS.length}`;
  elements.progressTitle.textContent = STEPS[state.step].title;
  elements.progressBar.style.width = `${(human / STEPS.length) * 100}%`;
  elements.progressBar.parentElement.setAttribute('aria-valuenow', String(human));

  elements.back.hidden = state.step === 0;
  elements.next.hidden = state.step === STEPS.length - 1;
  elements.submit.hidden = state.step !== STEPS.length - 1;

  elements.summary.hidden = true;
  state.draft.step = state.step;
  saveDraft(state.draft);

  window.scrollTo({ top: 0, behavior: 'instant' });
  if (focus) {
    elements.steps.querySelector(`[data-step="${state.step}"] h2`)?.focus?.();
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
  if (step && Number(step.dataset.step) !== state.step) goToStep(Number(step.dataset.step));
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

  // Le contrôle du total se fait AVANT l'envoi. Auparavant la limite n'était
  // appliquée que par input, donc on pouvait dépasser puis se faire refuser
  // la transmission entière après avoir tout téléversé.
  for (const file of files.slice(0, remaining)) {
    const placeholder = appendPhoto(
      { id: `attente-${Math.random().toString(36).slice(2)}`, fieldName, filename: file.name },
      { pending: true }
    );
    try {
      const photo = await uploadPhoto({ file, fieldName, clientRef: state.draft.clientRef });
      state.draft.photos.push({
        id: photo.id, fieldName, category: photo.category, filename: photo.filename
      });
      saveDraft(state.draft, { immediate: true });
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
  image.src = photo.dataUrl || `/api/uploads/${photo.id}`;
  item.append(image);

  if (pending) {
    const state_ = document.createElement('span');
    state_.className = 'photo__state';
    state_.textContent = 'Envoi…';
    item.append(state_);
  } else {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'photo__remove';
    remove.dataset.removePhoto = photo.id;
    remove.setAttribute('aria-label', `Retirer la photo ${photo.filename || ''}`.trim());
    remove.append(icon('M18 6 6 18M6 6l12 12'));
    item.append(remove);
  }
  return item;
}

async function removePhoto(id) {
  const item = elements.steps.querySelector(`[data-photo-id="${CSS.escape(id)}"]`);
  item?.remove();
  state.draft.photos = state.draft.photos.filter(photo => photo.id !== id);
  saveDraft(state.draft, { immediate: true });
  await api.deletePhoto(id).catch(() => {
    // La photo disparaît de l'écran quoi qu'il arrive ; les orphelines sont
    // purgées côté serveur par la tâche d'entretien.
  });
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
    if (stepIndex >= 0 && stepIndex !== state.step) goToStep(stepIndex);
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

    rememberPhone(values.recipientPhone.replace(/[\s().-]/g, ''));
    // À partir d'ici l'enregistrement est acquis. Tout ce qui suit, PDF,
    // WhatsApp, peut échouer sans remettre les données en cause.
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
  $('#progress').hidden = true;

  const phone = values.recipientPhone.replace(/[\s().-]/g, '');
  const greeting = result.greeting || 'Bonjour, veuillez trouver ci-joint la transmission du jour.';

  elements.done.innerHTML = `
    <div class="card">
      <p class="eyebrow">Transmission enregistrée</p>
      <h2>${escapeHtml(result.alreadySaved ? 'Déjà enregistrée' : 'C’est enregistré')}</h2>
      <p class="card__hint">${escapeHtml(
        result.alreadySaved
          ? 'Cette transmission avait déjà été envoyée : aucune ligne en double n’a été créée.'
          : 'Les données sont en sécurité. Récupérez le PDF puis partagez-le sur WhatsApp.'
      )}</p>
      ${result.sheet?.status !== 'synced' ? `
        <p class="alert alert--warn" style="margin-top:16px">
          La copie vers Google Sheets n’a pas encore abouti. L’enregistrement est
          bien fait et la copie sera reprise automatiquement.
        </p>` : ''}
      <div class="stack" style="margin-top:24px">
        <button type="button" class="btn btn--primary" id="get-pdf">Télécharger le PDF</button>
        <a class="btn btn--ghost" id="open-whatsapp"
           href="https://wa.me/${encodeURIComponent(phone.slice(1))}?text=${encodeURIComponent(greeting)}"
           target="_blank" rel="noopener">Ouvrir WhatsApp</a>
        <button type="button" class="btn btn--quiet" id="restart">Nouvelle transmission</button>
      </div>
      <p class="status" id="done-status"></p>
    </div>`;
  elements.done.hidden = false;
  elements.done.focus();

  const doneStatus = $('#done-status');
  const filename = `transmission-${values.date}.pdf`;

  $('#get-pdf').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    doneStatus.textContent = 'Préparation du PDF…';
    try {
      const file = await fetchPdf(result.pdfUrl, filename);
      // Sur téléphone, le partage natif permet d'envoyer le PDF directement
      // dans WhatsApp. Ailleurs, on télécharge.
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], text: greeting });
        doneStatus.textContent = 'Choisissez WhatsApp puis le destinataire.';
      } else {
        download(file);
        doneStatus.textContent = 'PDF téléchargé. Joignez-le dans WhatsApp.';
      }
    } catch (error) {
      if (error?.name === 'AbortError') doneStatus.textContent = 'Partage annulé.';
      else doneStatus.textContent = error.message || 'PDF indisponible.';
    } finally {
      button.disabled = false;
    }
  });

  $('#restart').addEventListener('click', () => {
    clearDraft();
    location.reload();
  });

  // Le brouillon n'est effacé qu'une fois la transmission acquise côté serveur.
  clearDraft();
  state.draft = { clientRef: newClientRef(), values: {}, photos: [], step: 0 };
}

function download(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* --------------------------------------------------------------- utilitaires */

let statusTimer = null;

function setStatus(message, kind = '') {
  elements.status.className = `status${kind ? ` status--${kind === 'busy' ? '' : kind}` : ''}`.trim();
  elements.status.innerHTML = kind === 'busy' ? '<span class="spinner"></span>' : '';
  elements.status.append(message);
  clearTimeout(statusTimer);
  if (kind === 'saved') {
    statusTimer = setTimeout(() => { elements.status.textContent = ''; }, 2500);
  }
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
