import { api, fetchFile } from './api.js';
import { saveFile, setupChrome } from './chrome.js';
import { icon } from './icons.js';

const ROLE = {
  admin: ['brand', 'Administration'],
  aidant: ['ok', 'Aidante'],
  famille: ['accent', 'Famille']
};

const $ = selector => document.querySelector(selector);
const state = { me: null, people: [], users: [] };

init().catch(error => showError(error.message));

async function init() {
  state.me = await setupChrome({ page: 'admin', roles: ['admin'] });
  if (!state.me) return;

  $('#add-person').addEventListener('submit', addPerson);
  $('#add-account').addEventListener('submit', addAccount);
  $('#generate').addEventListener('click', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(9));
    $('#account-password').value = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
  });

  await refresh();
}

async function refresh() {
  const [people, users] = await Promise.all([api.admin.beneficiaries(), api.admin.users()]);
  state.people = people.beneficiaries;
  state.users = users.users;
  renderPeople();
  renderAccounts();
}

/* ---------------------------------------------------------------- fiches */

function renderPeople() {
  const list = $('#people');
  if (!state.people.length) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.textContent = 'Aucune fiche pour le moment.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...state.people.map(person => {
    const row = document.createElement('li');
    row.className = `row${person.is_active ? '' : ' row--inactive'}`;

    const main = document.createElement('div');
    main.className = 'row__main';
    const title = document.createElement('p');
    title.className = 'row__title';
    title.textContent = person.full_name;
    const sub = document.createElement('p');
    sub.className = 'row__sub';
    sub.textContent = [
      `${person.transmissions} transmission${person.transmissions > 1 ? 's' : ''}`,
      `${person.accounts} compte${person.accounts > 1 ? 's' : ''} rattaché${person.accounts > 1 ? 's' : ''}`,
      person.is_active ? null : 'archivée'
    ].filter(Boolean).join(' · ');
    main.append(title, sub);

    const actions = document.createElement('div');
    actions.className = 'row__actions';

    // L'export n'a de sens que s'il y a des journées à tracer.
    if (person.transmissions > 0) {
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.className = 'btn btn--ghost btn--small';
      exportButton.append(icon('download'), 'CSV');
      exportButton.title = `Exporter les ${person.transmissions} transmissions de ${person.full_name}`;
      exportButton.addEventListener('click', () => exportCsv(person, exportButton));
      actions.append(exportButton);
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn--quiet btn--small';
    toggle.textContent = person.is_active ? 'Archiver' : 'Réactiver';
    toggle.addEventListener('click', async () => {
      await run(() => api.admin.updateBeneficiary(person.id, { isActive: !person.is_active }),
        person.is_active ? `${person.full_name} archivée.` : `${person.full_name} réactivée.`);
    });
    actions.append(toggle);

    row.append(main, actions);
    return row;
  }));
}

/**
 * Télécharge l'historique complet d'une personne en CSV, prêt pour un tableur.
 * Passe par fetch plutôt qu'un lien direct : une erreur revient alors en
 * message et non en fichier illisible.
 */
async function exportCsv(person, button) {
  const label = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(Object.assign(document.createElement('span'), { className: 'spinner' }), 'Export…');
  try {
    const file = await fetchFile(
      `/api/admin/beneficiaries/${person.id}/export.csv`,
      `transmissions-${person.id}.csv`
    );
    saveFile(file);
    setStatus(`${file.name} téléchargé, ${person.transmissions} transmission${person.transmissions > 1 ? 's' : ''}.`);
  } catch (error) {
    showError(error.message || 'Export impossible.');
  } finally {
    button.replaceChildren(...label);
    button.disabled = false;
  }
}

async function addPerson(event) {
  event.preventDefault();
  const input = $('#person-name');
  const fullName = input.value.trim();
  if (fullName.length < 2) {
    showError('Renseignez le nom de la personne accompagnée.');
    input.focus();
    return;
  }
  const done = await run(() => api.admin.createBeneficiary(fullName), `Fiche créée pour ${fullName}.`);
  if (done) input.value = '';
}

/* --------------------------------------------------------------- comptes */

function renderAccounts() {
  const container = $('#accounts');
  const order = { admin: 0, aidant: 1, famille: 2 };
  const users = [...state.users].sort((a, b) =>
    order[a.role] - order[b.role] || a.full_name.localeCompare(b.full_name, 'fr'));

  container.replaceChildren(...users.map(user => {
    const card = document.createElement('article');
    card.className = 'account-card';
    if (!user.is_active) card.style.opacity = '.65';

    const head = document.createElement('div');
    head.className = 'account-card__head';

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = user.full_name.split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('');

    const main = document.createElement('div');
    main.className = 'row__main';
    const name = document.createElement('p');
    name.className = 'row__title';
    name.textContent = user.full_name + (user.id === state.me.id ? ' (vous)' : '');
    const email = document.createElement('p');
    email.className = 'row__sub';
    email.textContent = user.email + (user.is_active ? '' : ' · désactivé');
    main.append(name, email);

    const [tone, label] = ROLE[user.role] || ['brand', user.role];
    const badge = document.createElement('span');
    badge.className = `badge badge--${tone}`;
    badge.textContent = label;

    head.append(avatar, main, badge);
    card.append(head);

    const body = document.createElement('div');
    body.className = 'account-card__body';

    if (user.role === 'admin') {
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = 'Voit toutes les personnes, sans rattachement.';
      body.append(note);
    } else {
      body.append(linksEditor(user));
    }

    body.append(profileEditor(user));

    if (user.id !== state.me.id) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `btn btn--small ${user.is_active ? 'btn--danger' : 'btn--ghost'}`;
      toggle.style.marginTop = '10px';
      toggle.textContent = user.is_active ? 'Désactiver le compte' : 'Réactiver le compte';
      toggle.addEventListener('click', async () => {
        if (user.is_active && !confirm(`Désactiver le compte de ${user.full_name} ? Il sera déconnecté de tous ses appareils.`)) return;
        await run(() => api.admin.setUserActive(user.id, !user.is_active),
          user.is_active ? 'Compte désactivé.' : 'Compte réactivé.');
      });
      body.append(toggle);
    }

    card.append(body);
    return card;
  }));
}

/**
 * Corriger un compte sans le recréer : nom affiché, adresse de connexion,
 * mot de passe. Replié par défaut, pour ne pas alourdir la liste.
 */
function profileEditor(user) {
  const details = document.createElement('details');
  details.className = 'disclosure';
  details.style.marginTop = '12px';

  const summary = document.createElement('summary');
  summary.className = 'btn btn--quiet btn--small';
  summary.style.display = 'inline-flex';
  summary.append(icon('user'), 'Modifier ce compte');
  details.append(summary);

  const form = document.createElement('form');
  form.className = 'grid grid--pair';
  form.style.marginTop = '14px';
  form.noValidate = true;

  const field = (label, name, { type = 'text', value = '', help = '', autocomplete = 'off' } = {}) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const id = `champ-${name}-${user.id}`;
    const labelElement = document.createElement('label');
    labelElement.className = 'field__label';
    labelElement.setAttribute('for', id);
    labelElement.textContent = label;
    const input = document.createElement('input');
    input.id = id;
    input.name = name;
    input.type = type;
    input.value = value;
    input.autocomplete = autocomplete;
    if (name === 'email') input.autocapitalize = 'none';
    wrapper.append(labelElement, input);
    if (help) {
      const hint = document.createElement('p');
      hint.className = 'field__help';
      hint.textContent = help;
      wrapper.append(hint);
    }
    return wrapper;
  };

  form.append(
    field('Nom complet', 'fullName', { value: user.full_name }),
    field('Adresse de connexion', 'email', { type: 'email', value: user.email }),
    field('Nouveau mot de passe', 'password', {
      value: '',
      autocomplete: 'new-password',
      help: 'Laissez vide pour ne pas le changer. 10 caractères minimum.'
    })
  );

  const generate = document.createElement('button');
  generate.type = 'button';
  generate.className = 'btn btn--ghost btn--small';
  generate.style.alignSelf = 'end';
  generate.textContent = 'Générer un mot de passe';
  generate.addEventListener('click', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(9));
    form.password.value = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
    form.password.type = 'text';
  });
  form.append(generate);

  const save = document.createElement('div');
  save.className = 'field field--wide';
  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'btn btn--primary btn--small';
  button.append(icon('check'), 'Enregistrer les modifications');
  save.append(button);
  form.append(save);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const patch = {};
    if (form.fullName.value.trim() !== user.full_name) patch.fullName = form.fullName.value.trim();
    if (form.email.value.trim().toLowerCase() !== user.email) patch.email = form.email.value.trim();
    if (form.password.value) patch.password = form.password.value;

    if (!Object.keys(patch).length) {
      showError('Aucune modification à enregistrer.');
      return;
    }
    if (patch.password && !confirm(
      `Remplacer le mot de passe de ${user.full_name} ? Le compte sera déconnecté de tous ses appareils et devra utiliser le nouveau mot de passe.`
    )) return;

    const message = [
      patch.fullName ? 'nom' : null,
      patch.email ? 'adresse' : null,
      patch.password ? 'mot de passe' : null
    ].filter(Boolean).join(', ');

    const done = await run(() => api.admin.updateUser(user.id, patch), `Compte mis à jour : ${message}.`);
    if (!done) return;
    form.password.value = '';
    // Le nom affiché dans l'en-tête vient de la session : il faut recharger
    // la page pour le voir changer sur son propre compte.
    if (user.id === state.me.id && patch.fullName) location.reload();
  });

  details.append(form);
  return details;
}

function linksEditor(user) {
  const wrapper = document.createElement('div');
  const legend = document.createElement('p');
  legend.className = 'field__label';
  legend.textContent = user.role === 'aidant' ? 'Personnes que ce compte peut saisir' : 'Personnes que ce compte peut consulter';
  wrapper.append(legend);

  const linked = new Set(user.beneficiary_ids);
  // Les fiches archivées restent visibles si le compte y est encore rattaché.
  const choices = state.people.filter(person => person.is_active || linked.has(person.id));

  if (!choices.length) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Créez d’abord une fiche de personne accompagnée.';
    wrapper.append(note);
    return wrapper;
  }

  const checks = document.createElement('div');
  checks.className = 'checks';
  for (const person of choices) {
    const label = document.createElement('label');
    label.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = person.id;
    box.checked = linked.has(person.id);
    label.append(box, person.full_name);
    checks.append(label);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn--ghost btn--small';
  save.append(icon('check'), 'Enregistrer les accès');
  save.addEventListener('click', async () => {
    const ids = [...checks.querySelectorAll('input:checked')].map(box => box.value);
    await run(() => api.admin.setUserBeneficiaries(user.id, ids), `Accès de ${user.full_name} enregistrés.`);
  });

  if (!linked.size && user.role === 'famille') {
    // Une note qui revient à la ligne, pas un badge : le texte est trop long
    // pour tenir sur une ligne de téléphone.
    const warning = document.createElement('p');
    warning.className = 'note note--warn';
    warning.append(icon('alert'), 'Ne voit aucune transmission tant qu’aucune personne n’est cochée.');
    wrapper.append(warning);
  }

  wrapper.append(checks, save);
  return wrapper;
}

async function addAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    fullName: form.fullName.value.trim(),
    email: form.email.value.trim(),
    role: form.role.value,
    password: form.password.value
  };
  const done = await run(() => api.admin.createUser(payload),
    `Compte créé pour ${payload.fullName}. Transmettez-lui son mot de passe provisoire, puis cochez ses accès.`);
  if (done) {
    form.reset();
    form.closest('details').open = false;
  }
}

/* ------------------------------------------------------------ utilitaires */

async function run(action, success) {
  $('#error').hidden = true;
  try {
    await action();
    await refresh();
    setStatus(success);
    return true;
  } catch (error) {
    showError(error.message || 'Opération impossible.');
    return false;
  }
}

let statusTimer = null;
function setStatus(message) {
  const status = $('#status');
  status.className = 'status status--saved';
  status.replaceChildren(icon('check'), message);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => status.replaceChildren(), 5000);
}

function showError(message) {
  const error = $('#error');
  error.textContent = message;
  error.hidden = false;
  error.focus();
}
