/**
 * Source unique de vérité des champs de la transmission.
 *
 * Ce fichier alimente : le rendu du formulaire (côté navigateur, via /api/schema),
 * la validation serveur, la construction du message WhatsApp, le PDF et l'en-tête
 * de la feuille Google Sheets. Ajouter un champ ici suffit : il apparaît partout.
 *
 * Type de champ :
 *   text | textarea | date | number | select | tel | photo
 *
 * showIf : { field, equals: [...] }
 *   Le champ n'est affiché que si `field` vaut une des valeurs de `equals`.
 *   Le serveur applique la même règle et efface la valeur des champs masqués,
 *   ce qui évite d'enregistrer des données fantômes.
 */

export const SECTIONS = [
  {
    id: 'general',
    title: 'Informations générales',
    hint: 'Qui, quand, dans quel contexte.',
    fields: [
      { name: 'date', label: 'Date du suivi', type: 'date', required: true },
      { name: 'personName', label: 'Personne accompagnée', type: 'text', required: true, placeholder: 'Nom et prénom' },
      { name: 'caregiverName', label: 'Accompagnant(e)', type: 'text', required: true, placeholder: 'Nom et prénom' },
      { name: 'period', label: 'Moment du suivi', type: 'select', options: ['Matin', 'Après-midi', 'Soir', 'Journée complète'] },
      { name: 'generalDescription', label: 'Contexte de la journée', type: 'textarea', help: 'Facultatif : information utile pour comprendre la journée.' }
    ]
  },
  {
    id: 'health',
    title: 'État général et santé',
    hint: 'Comment elle va aujourd’hui.',
    fields: [
      { name: 'generalState', label: 'État général', type: 'select', required: true, options: ['Très bon', 'Bon', 'Moyen', 'Fatiguée', 'Préoccupant'] },
      { name: 'healthIssue', label: 'Malaise ou problème particulier ?', type: 'select', required: true, options: ['Non', 'Oui'] },
      { name: 'healthIssueDetails', label: 'Décrivez le malaise ou le problème', type: 'textarea', required: true, showIf: { field: 'healthIssue', equals: ['Oui'] } },
      { name: 'pain', label: 'Douleur ou gêne ?', type: 'select', options: ['Non', 'Oui'] },
      { name: 'painDetails', label: 'Précisez la douleur ou la gêne', type: 'textarea', required: true, showIf: { field: 'pain', equals: ['Oui'] } },
      { name: 'healthObservation', label: 'Autre observation santé', type: 'textarea' }
    ]
  },
  {
    id: 'vitals',
    title: 'Constantes',
    hint: 'Laissez vide ce qui n’a pas été mesuré.',
    fields: [
      { name: 'bpLeftMorning', label: 'Tension bras gauche — matin', type: 'text', placeholder: '12 / 8' },
      { name: 'bpRightMorning', label: 'Tension bras droit — matin', type: 'text', placeholder: '12 / 8' },
      { name: 'pulseMorning', label: 'Pouls — matin', type: 'number', unit: 'bpm', min: 20, max: 250, inputmode: 'numeric' },
      { name: 'glucoseMorning', label: 'Glycémie — matin', type: 'number', unit: 'g/L', min: 0, max: 10, step: 0.01, inputmode: 'decimal' },
      { name: 'bpLeftEvening', label: 'Tension bras gauche — soir', type: 'text', placeholder: '12 / 8' },
      { name: 'bpRightEvening', label: 'Tension bras droit — soir', type: 'text', placeholder: '12 / 8' },
      { name: 'pulseEvening', label: 'Pouls — soir', type: 'number', unit: 'bpm', min: 20, max: 250, inputmode: 'numeric' },
      { name: 'glucoseEvening', label: 'Glycémie — soir', type: 'number', unit: 'g/L', min: 0, max: 10, step: 0.01, inputmode: 'decimal' },
      { name: 'weight', label: 'Poids', type: 'number', unit: 'kg', min: 20, max: 300, step: 0.1, inputmode: 'decimal' }
    ]
  },
  {
    id: 'medication',
    title: 'Médicaments',
    fields: [
      { name: 'medicationTaken', label: 'Médicaments prévus pris ?', type: 'select', required: true, options: ['Oui, tous', 'Partiellement', 'Non', 'Non concernés'] },
      { name: 'medicationMissing', label: 'Médicament(s) non pris ou manquants', type: 'textarea', showIf: { field: 'medicationTaken', equals: ['Partiellement', 'Non'] } },
      { name: 'medicationReason', label: 'Raison de la non-prise', type: 'select', options: ['Refus', 'Oubli', 'Absence du médicament', 'Effet indésirable', 'Autre'], showIf: { field: 'medicationTaken', equals: ['Partiellement', 'Non'] } },
      { name: 'medicationObservation', label: 'Observation médicaments', type: 'textarea' }
    ]
  },
  {
    id: 'nutrition',
    title: 'Alimentation et hydratation',
    fields: [
      { name: 'breakfastTaken', label: 'Petit-déjeuner', type: 'select', options: ['Oui', 'Non', 'Non concerné'] },
      { name: 'breakfastDetails', label: 'Petit-déjeuner : aliments ou boissons', type: 'textarea', showIf: { field: 'breakfastTaken', equals: ['Oui'] } },
      { name: 'breakfastPhoto', label: 'Photo du petit-déjeuner', type: 'photo', showIf: { field: 'breakfastTaken', equals: ['Oui'] } },
      { name: 'lunchTaken', label: 'Déjeuner', type: 'select', options: ['Oui', 'Non', 'Non concerné'] },
      { name: 'lunchDetails', label: 'Déjeuner : aliments consommés', type: 'textarea', showIf: { field: 'lunchTaken', equals: ['Oui'] } },
      { name: 'lunchPhoto', label: 'Photo du déjeuner', type: 'photo', showIf: { field: 'lunchTaken', equals: ['Oui'] } },
      { name: 'dinnerTaken', label: 'Dîner', type: 'select', options: ['Oui', 'Non', 'Non concerné'] },
      { name: 'dinnerDetails', label: 'Dîner : aliments consommés', type: 'textarea', showIf: { field: 'dinnerTaken', equals: ['Oui'] } },
      { name: 'dinnerPhoto', label: 'Photo du dîner', type: 'photo', showIf: { field: 'dinnerTaken', equals: ['Oui'] } },
      { name: 'hydration', label: 'Hydratation', type: 'select', options: ['Bonne', 'Correcte', 'Insuffisante', 'À surveiller'] },
      { name: 'nutritionObservation', label: 'Observation alimentation / hydratation', type: 'textarea' }
    ]
  },
  {
    id: 'mobility',
    title: 'Activités et mobilité',
    fields: [
      { name: 'mobility', label: 'Déplacement ou marche ?', type: 'select', options: ['Oui, sans difficulté', 'Oui, avec aide', 'Non', 'Repos recommandé'] },
      { name: 'activities', label: 'Activités réalisées', type: 'textarea' },
      { name: 'activityFeeling', label: 'Ressenti après activité', type: 'select', options: ['Bien', 'Fatiguée', 'Essoufflée', 'Douleur', 'Non concerné'] },
      { name: 'mobilityObservation', label: 'Observation mobilité', type: 'textarea' }
    ]
  },
  {
    id: 'care',
    title: 'Hygiène et soins',
    fields: [
      { name: 'carePerformed', label: 'Soins réalisés', type: 'textarea', placeholder: 'Toilette, habillage, coiffure, soins…' },
      { name: 'careNotDone', label: 'Soin prévu non réalisé ?', type: 'select', options: ['Non', 'Oui'] },
      { name: 'careNotDoneDetails', label: 'Soin non réalisé et raison', type: 'textarea', required: true, showIf: { field: 'careNotDone', equals: ['Oui'] } }
    ]
  },
  {
    id: 'wellbeing',
    title: 'Repos et bien-être',
    fields: [
      { name: 'rest', label: 'Repos suffisant ?', type: 'select', options: ['Oui', 'Partiellement', 'Non', 'Non concerné'] },
      { name: 'mood', label: 'Humeur / état émotionnel', type: 'select', options: ['Sereine', 'Bonne humeur', 'Tristesse', 'Anxiété', 'Irritabilité', 'Fatigue'] },
      { name: 'wellbeingObservation', label: 'Observation repos, sommeil ou bien-être', type: 'textarea' }
    ]
  },
  {
    id: 'expense',
    title: 'Achats et dépenses',
    fields: [
      { name: 'hasExpense', label: 'Une dépense a-t-elle eu lieu ?', type: 'select', required: true, options: ['Non', 'Oui'] },
      { name: 'expenseItem', label: 'Produit ou service acheté', type: 'text', required: true, showIf: { field: 'hasExpense', equals: ['Oui'] } },
      { name: 'expenseAmount', label: 'Montant', type: 'number', unit: 'FCFA', min: 0, step: 1, inputmode: 'numeric', required: true, showIf: { field: 'hasExpense', equals: ['Oui'] } },
      { name: 'expenseAuthorized', label: 'Achat autorisé ou prévu ?', type: 'select', options: ['Oui', 'Non', 'À vérifier'], showIf: { field: 'hasExpense', equals: ['Oui'] } },
      { name: 'receiptAvailable', label: 'Preuve d’achat disponible ?', type: 'select', options: ['Oui', 'Non'], showIf: { field: 'hasExpense', equals: ['Oui'] } },
      { name: 'receiptPhoto', label: 'Photo du reçu', type: 'photo', showIf: { field: 'receiptAvailable', equals: ['Oui'] } },
      { name: 'expenseComment', label: 'Commentaire sur l’achat', type: 'textarea', showIf: { field: 'hasExpense', equals: ['Oui'] } }
    ]
  },
  {
    id: 'events',
    title: 'Événements et points d’attention',
    fields: [
      { name: 'hasEvent', label: 'Événement particulier ?', type: 'select', required: true, options: ['Non', 'Oui'] },
      { name: 'eventDescription', label: 'Décrivez l’événement', type: 'textarea', required: true, showIf: { field: 'hasEvent', equals: ['Oui'] } },
      { name: 'attentionLevel', label: 'Niveau d’attention', type: 'select', options: ['Information', 'À surveiller', 'Important', 'Urgent'], showIf: { field: 'hasEvent', equals: ['Oui'] } },
      { name: 'requiredAction', label: 'Action nécessaire', type: 'text', showIf: { field: 'hasEvent', equals: ['Oui'] } }
    ]
  },
  {
    id: 'summary',
    title: 'Bilan de la journée',
    hint: 'C’est le texte que la famille lira en premier.',
    fields: [
      { name: 'daySummary', label: 'Résumé général', type: 'textarea', required: true, placeholder: 'La journée s’est globalement bien déroulée…' },
      { name: 'finalNotes', label: 'Autres remarques', type: 'textarea' },
      { name: 'otherPhotos', label: 'Autres photos de la journée', type: 'photo', multiple: true, help: 'Ces photos s’ajoutent à celles des repas et du reçu.' }
    ]
  },
  {
    id: 'share',
    title: 'Partage',
    fields: [
      { name: 'recipientPhone', label: 'Numéro WhatsApp du destinataire', type: 'tel', required: true, placeholder: '+225 07 00 00 00 00', inputmode: 'tel', help: 'Format international. Mémorisé sur cet appareil uniquement.' }
    ]
  }
];

/** Nombre maximum de photos par transmission, toutes catégories confondues. */
export const MAX_IMAGES = 8;

/** Taille maximale d'une photo après compression navigateur, en octets. */
export const MAX_IMAGE_BYTES = 1_500_000;

/** Liste à plat de tous les champs, dans l'ordre d'affichage. */
export const FIELDS = SECTIONS.flatMap(section =>
  section.fields.map(field => ({ ...field, sectionId: section.id, sectionTitle: section.title }))
);

/** Champs stockés en colonnes texte (les photos sont gérées séparément). */
export const DATA_FIELDS = FIELDS.filter(field => field.type !== 'photo');

const BY_NAME = new Map(FIELDS.map(field => [field.name, field]));

export const getField = name => BY_NAME.get(name);

/**
 * Un champ conditionnel est actif si son champ parent a la bonne valeur,
 * et si ce parent est lui-même actif (les conditions s'enchaînent).
 */
export function isFieldActive(field, values) {
  if (!field?.showIf) return true;
  const parent = BY_NAME.get(field.showIf.field);
  if (parent && !isFieldActive(parent, values)) return false;
  return field.showIf.equals.includes(String(values?.[field.showIf.field] ?? '').trim());
}

/** En-tête de la feuille Google Sheets, dérivé du schéma. */
export const SHEET_HEADER = [
  'Horodatage',
  'Identifiant',
  'Auteur',
  ...DATA_FIELDS.map(field => field.label),
  'Photos',
  'Résumé WhatsApp'
];
