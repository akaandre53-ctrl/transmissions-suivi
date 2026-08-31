/**
 * Rendu du formulaire à partir du schéma servi par /api/schema.
 *
 * Le formulaire n'est plus écrit en dur dans le HTML. Front et serveur lisent
 * la même définition de champs, donc un nom de champ ne peut plus diverger
 * entre les deux — c'était une source de bugs silencieux (valeur saisie,
 * jamais enregistrée).
 */

const REQUIRED_MARK = 'obligatoire';

export function createField(field) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  wrapper.dataset.field = field.name;
  if (field.type === 'textarea' || field.type === 'photo') wrapper.classList.add('field--wide');

  const id = `champ-${field.name}`;
  const errorId = `${id}-erreur`;

  const label = document.createElement('label');
  label.className = 'field__label';
  label.setAttribute('for', id);
  label.append(field.label);
  if (field.required) {
    const mark = document.createElement('span');
    mark.className = 'field__required';
    mark.textContent = REQUIRED_MARK;
    label.append(mark);
  }
  wrapper.append(label);

  const control = document.createElement('div');
  control.className = 'field__control';
  control.append(buildControl(field, id, errorId));
  if (field.unit) {
    const unit = document.createElement('span');
    unit.className = 'field__unit';
    unit.textContent = field.unit;
    control.append(unit);
  }
  wrapper.append(control);

  if (field.help) {
    const help = document.createElement('p');
    help.className = 'field__help';
    help.id = `${id}-aide`;
    help.textContent = field.help;
    wrapper.append(help);
    control.firstElementChild.setAttribute(
      'aria-describedby',
      `${help.id} ${errorId}`
    );
  }

  const error = document.createElement('p');
  error.className = 'field__error';
  error.id = errorId;
  // role=alert : l'erreur est annoncée dès qu'elle apparaît.
  error.setAttribute('role', 'alert');
  wrapper.append(error);

  return wrapper;
}

function buildControl(field, id, errorId) {
  if (field.type === 'select') {
    const select = document.createElement('select');
    select.id = id;
    select.name = field.name;
    if (field.required) {
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Choisir…';
      select.append(blank);
    }
    for (const option of field.options) {
      const element = document.createElement('option');
      element.value = option;
      element.textContent = option;
      select.append(element);
    }
    if (!field.required) select.value = field.options[0];
    select.setAttribute('aria-describedby', errorId);
    return select;
  }

  if (field.type === 'textarea') {
    const textarea = document.createElement('textarea');
    textarea.id = id;
    textarea.name = field.name;
    textarea.rows = 3;
    if (field.placeholder) textarea.placeholder = field.placeholder;
    textarea.setAttribute('aria-describedby', errorId);
    return textarea;
  }

  const input = document.createElement('input');
  input.id = id;
  input.name = field.name;
  input.type = { date: 'date', number: 'number', tel: 'tel' }[field.type] || 'text';
  if (field.placeholder) input.placeholder = field.placeholder;
  if (field.inputmode) input.inputMode = field.inputmode;
  if (field.min !== undefined) input.min = field.min;
  if (field.max !== undefined) input.max = field.max;
  if (field.step !== undefined) input.step = field.step;
  // Les noms de personnes ne gagnent rien à être corrigés automatiquement.
  if (field.type === 'text') input.autocapitalize = 'sentences';
  input.setAttribute('aria-describedby', errorId);
  return input;
}

/* ----------------------------------------------------- conditions d'affichage */

/** Même logique que le serveur : un parent masqué masque ses enfants. */
export function isFieldActive(field, values, byName) {
  if (!field?.showIf) return true;
  const parent = byName.get(field.showIf.field);
  if (parent && !isFieldActive(parent, values, byName)) return false;
  return field.showIf.equals.includes(String(values?.[field.showIf.field] ?? '').trim());
}

/* --------------------------------------------------------------- validation */

const PHONE = /^\+\d{8,15}$/;

/**
 * Valide les champs d'un ensemble donné. Un champ inactif n'est jamais requis
 * ni contrôlé : c'est ce qui évite le blocage « champ obligatoire invisible »,
 * où le navigateur refuse de soumettre sans pouvoir montrer le champ fautif.
 */
export function validateFields(fields, values, byName) {
  const errors = [];
  for (const field of fields) {
    if (field.type === 'photo') continue;
    if (!isFieldActive(field, values, byName)) continue;

    const value = String(values[field.name] ?? '').trim();

    if (field.required && !value) {
      errors.push({ field: field.name, message: `« ${field.label} » est obligatoire.` });
      continue;
    }
    if (!value) continue;

    if (field.type === 'number') {
      const number = Number(value.replace(',', '.'));
      if (!Number.isFinite(number)) {
        errors.push({ field: field.name, message: `« ${field.label} » doit être un nombre.` });
      } else if (field.min !== undefined && number < field.min) {
        errors.push({ field: field.name, message: `« ${field.label} » ne peut pas être inférieur à ${field.min}.` });
      } else if (field.max !== undefined && number > field.max) {
        errors.push({ field: field.name, message: `« ${field.label} » ne peut pas dépasser ${field.max}.` });
      }
    }

    if (field.type === 'tel' && !PHONE.test(value.replace(/[\s().-]/g, ''))) {
      errors.push({
        field: field.name,
        message: 'Utilisez un numéro international, par exemple +2250700000000.'
      });
    }
  }
  return errors;
}

/* ------------------------------------------------------- affichage des erreurs */

export function showFieldError(root, name, message) {
  const wrapper = root.querySelector(`.field[data-field="${CSS.escape(name)}"]`);
  if (!wrapper) return;
  wrapper.classList.add('field--invalid');
  const error = wrapper.querySelector('.field__error');
  if (error) error.textContent = message;
  const control = wrapper.querySelector('input, select, textarea');
  control?.setAttribute('aria-invalid', 'true');
}

export function clearFieldError(root, name) {
  const wrapper = root.querySelector(`.field[data-field="${CSS.escape(name)}"]`);
  if (!wrapper) return;
  wrapper.classList.remove('field--invalid');
  const error = wrapper.querySelector('.field__error');
  if (error) error.textContent = '';
  wrapper.querySelector('input, select, textarea')?.removeAttribute('aria-invalid');
}

export function clearAllErrors(root) {
  for (const wrapper of root.querySelectorAll('.field--invalid')) {
    clearFieldError(root, wrapper.dataset.field);
  }
}

/**
 * Récapitulatif d'erreurs en tête d'étape.
 * Chaque ligne est un lien vers le champ concerné, et le focus vient s'y poser :
 * une erreur signalée uniquement en couleur est invisible au clavier et au
 * lecteur d'écran.
 */
export function renderErrorSummary(container, errors, onJump) {
  container.innerHTML = '';
  if (!errors.length) {
    container.hidden = true;
    return;
  }

  const title = document.createElement('h2');
  title.textContent = errors.length === 1
    ? 'Un champ doit être corrigé'
    : `${errors.length} champs doivent être corrigés`;

  const list = document.createElement('ul');
  for (const error of errors) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#champ-${error.field}`;
    link.textContent = error.message;
    link.addEventListener('click', event => {
      event.preventDefault();
      onJump?.(error.field);
    });
    item.append(link);
    list.append(item);
  }

  container.append(title, list);
  container.hidden = false;
  container.focus();
}
