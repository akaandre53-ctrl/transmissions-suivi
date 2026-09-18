/**
 * Client HTTP.
 *
 * Toute la robustesse tient dans readJson() : l'ancienne version appelait
 * response.json() sans filet, donc la moindre réponse non-JSON, page d'erreur
 * 413 quand les photos dépassaient la limite, 504 de la passerelle, page de
 * maintenance, produisait un « Unexpected token < in JSON » incompréhensible
 * pour l'aidante. Ici, chaque cas devient un message en français.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'unknown', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const MESSAGES = {
  401: 'Votre session a expiré. Reconnectez-vous.',
  403: 'Vous n’avez pas accès à cette action.',
  404: 'Élément introuvable.',
  413: 'Les données envoyées sont trop volumineuses. Retirez une photo et réessayez.',
  429: 'Trop de tentatives. Patientez quelques minutes.',
  502: 'Le serveur ne répond pas correctement. Réessayez dans un instant.',
  503: 'Le service est momentanément indisponible. Réessayez dans un instant.',
  504: 'Le serveur a mis trop de temps à répondre. Vos données ne sont pas perdues, réessayez.'
};

async function readJson(response) {
  const type = response.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) {
    // On ne tente même pas response.json() : on fabrique un message utile.
    throw new ApiError(
      MESSAGES[response.status] || `Réponse inattendue du serveur (code ${response.status}).`,
      { status: response.status, code: 'non_json_response' }
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError('Réponse du serveur illisible. Réessayez.', {
      status: response.status,
      code: 'malformed_json'
    });
  }
}

export async function request(path, { method = 'GET', body, signal, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });

  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        // Contrôle d'origine côté serveur : un formulaire distant ne peut pas
        // poser cet en-tête.
        'X-Requested-With': 'transmission-app',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new ApiError(
        'La connexion a expiré. Vérifiez votre réseau, vos données restent enregistrées sur cet appareil.',
        { code: 'timeout' }
      );
    }
    throw new ApiError(
      'Impossible de joindre le serveur. Vérifiez votre connexion, rien n’est perdu, réessayez.',
      { code: 'offline' }
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return null;

  const payload = await readJson(response);

  if (!response.ok || payload?.ok === false) {
    throw new ApiError(
      payload?.error || MESSAGES[response.status] || 'Une erreur est survenue.',
      { status: response.status, code: payload?.code || 'error', details: payload?.details || null }
    );
  }
  return payload;
}

export const api = {
  schema: () => request('/api/schema'),

  me: () => request('/api/auth/me'),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: {} }),

  uploadPhoto: payload => request('/api/uploads', { method: 'POST', body: payload, timeoutMs: 60000 }),
  deletePhoto: id => request(`/api/uploads/${id}`, { method: 'DELETE' }),

  submit: payload => request('/api/transmissions', { method: 'POST', body: payload, timeoutMs: 45000 }),
  list: params => request(`/api/transmissions?${new URLSearchParams(params)}`),
  one: id => request(`/api/transmissions/${id}`),

  beneficiaries: () => request('/api/beneficiaries'),

  admin: {
    users: () => request('/api/admin/users'),
    createUser: payload => request('/api/admin/users', { method: 'POST', body: payload }),
    updateUser: (id, patch) => request(`/api/admin/users/${id}`, { method: 'PATCH', body: patch }),
    setUserActive: (id, isActive) => request(`/api/admin/users/${id}`, { method: 'PATCH', body: { isActive } }),
    setUserBeneficiaries: (id, beneficiaryIds) =>
      request(`/api/admin/users/${id}/beneficiaries`, { method: 'PUT', body: { beneficiaryIds } }),
    beneficiaries: () => request('/api/admin/beneficiaries'),
    createBeneficiary: fullName => request('/api/admin/beneficiaries', { method: 'POST', body: { fullName } }),
    updateBeneficiary: (id, patch) => request(`/api/admin/beneficiaries/${id}`, { method: 'PATCH', body: patch })
  }
};

/** Nom proposé par le serveur dans Content-Disposition, s'il y en a un. */
function filenameFrom(header) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header || '');
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Récupère un fichier servi par l'API (PDF, CSV) en propageant les erreurs
 * JSON : sans cela, une réponse d'erreur arriverait sous forme de fichier
 * illisible au lieu d'un message.
 */
export async function fetchFile(url, fallbackName, { errorMessage } = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'transmission-app' }
  });
  if (!response.ok) {
    const type = response.headers.get('Content-Type') || '';
    const message = type.includes('application/json')
      ? (await response.json().catch(() => ({})))?.error
      : null;
    throw new ApiError(message || MESSAGES[response.status] || errorMessage || 'Le fichier n’a pas pu être produit.', {
      status: response.status
    });
  }
  const blob = await response.blob();
  const name = filenameFrom(response.headers.get('Content-Disposition')) || fallbackName;
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

export const fetchPdf = (url, filename) =>
  fetchFile(url, filename, { errorMessage: 'Le PDF n’a pas pu être produit.' });
