# Transmission : suivi quotidien à domicile

Application de saisie de la transmission quotidienne d'une personne accompagnée.
L'aidant·e remplit le formulaire au fil de la journée, l'enregistre, récupère un
PDF structuré et le partage sur WhatsApp. La famille consulte l'historique et
retélécharge les PDF quand elle veut.

Aucun message WhatsApp n'est envoyé automatiquement, et aucune API WhatsApp
payante n'est utilisée : l'application prépare le PDF et le message, l'envoi
reste un geste manuel.

---

## Architecture

```
src/
  domain/schema.js      Source unique des champs, pilote le formulaire,
                        la validation, le PDF, le message et l'en-tête Sheets
  domain/validate.js    Validation serveur, effacement des champs masqués
  domain/access.js      Qui peut lire et saisir quoi, en fonctions pures
  auth/                 Mots de passe (scrypt), sessions en base, rôles, CSRF
  db/                   Pool Postgres, migrations SQL
  repositories/         Accès aux tables, sans logique métier
  services/             Orchestration : transmissions, PDF, message, miroir Sheets,
                        export CSV
  routes/               Points d'entrée HTTP
  app.js                Assemblage Express
public/
  index.html            Formulaire en 7 étapes
  login.html            Connexion
  historique.html       Frise des journées, filtre par personne, PDF
  admin.html            Personnes accompagnées, comptes et accès
  js/                   Modules ES natifs, sans dépendance ni build
tests/                  Tests de domaine, d'accès et de contrat HTTP
scripts/check-db.mjs    Contrôle d'intégration contre la vraie base
```

**Postgres est la source de vérité. Google Sheets en est un miroir** : la
famille garde le tableau qu'elle a l'habitude de consulter, mais une panne côté
Google ne peut plus empêcher un enregistrement.

---

## Installation

### 1. Node

Node 20 ou plus récent.

```bash
npm install
```

### 2. Base de données

Il faut un Postgres. Le plus simple est [Neon](https://neon.tech) (offre
gratuite) ; Supabase ou un Postgres local conviennent aussi.

Copiez `.env.example` vers `.env` et renseignez la chaîne de connexion :

```env
DATABASE_URL=postgresql://utilisateur:motdepasse@hote/base?sslmode=require
```

Sur Neon, prenez la chaîne **« Pooled connection »** : elle supporte les
nombreuses connexions courtes d'un hébergement serverless.

Créez ensuite les tables :

```bash
npm run migrate
```

### 3. Premier compte

```bash
npm run create-user -- --email vous@exemple.ci --nom "Votre Nom" --role admin
```

Le mot de passe est demandé sans être affiché. Sans terminal interactif, un mot
de passe est généré et affiché une seule fois.

Les autres comptes se créent ensuite depuis la page **Administration**.

### Qui voit quoi

Chaque transmission est rattachée à une **personne accompagnée** (une fiche),
et chaque compte aux personnes qu'il suit. Les règles sont dans
`src/domain/access.js` et appliquées en SQL pour les listes :

| Rôle      | Saisit pour                        | Voit                                          |
|-----------|------------------------------------|-----------------------------------------------|
| `aidant`  | les personnes qui lui sont confiées | les transmissions qu'il a saisies             |
| `famille` | personne                           | uniquement les personnes qui lui sont rattachées |
| `admin`   | tout le monde                      | tout, et gère fiches, comptes et accès        |

**Un compte famille sans rattachement ne voit rien.** C'est volontaire : un accès
oublié se corrige en un clic, un accès accordé à tort expose des données de
santé. Les photos et les PDF suivent la même règle que leur transmission.

Dans le formulaire, la personne se choisit dans une liste au lieu d'être tapée :
un nom mal orthographié ne peut plus créer une personne fantôme.

### 4. Google Sheets (facultatif)

L'application fonctionne sans. Si vous voulez le miroir :

```env
GOOGLE_SHEET_ID=identifiant_de_la_feuille
GOOGLE_APPLICATION_CREDENTIALS=./google-service-account.json
GOOGLE_SHEET_TAB=Transmissions
```

Créez un onglet nommé `Transmissions` et partagez la feuille avec l'adresse du
compte de service, en droit **Éditeur**. Les titres de colonnes sont ajoutés
automatiquement si l'onglet est vide.

En production, collez le contenu JSON complet de la clé dans
`GOOGLE_APPLICATION_CREDENTIALS` plutôt qu'un chemin de fichier.

### 5. Démarrage

```bash
npm start
```

Puis ouvrez http://localhost:3000.

---

## Déploiement sur Vercel

Variables d'environnement à définir dans le projet Vercel :

| Variable | Obligatoire | Remarque |
|---|---|---|
| `DATABASE_URL` | oui | chaîne *pooled* |
| `GOOGLE_SHEET_ID` | non | active le miroir Sheets |
| `GOOGLE_APPLICATION_CREDENTIALS` | non | le JSON complet de la clé |
| `CRON_SECRET` | recommandé | protège la tâche d'entretien |
| `SESSION_TTL_DAYS` | non | 30 par défaut |

Générez le secret :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Les migrations ne tournent pas toutes seules au déploiement. Lancez
`npm run migrate` depuis votre poste, la variable `DATABASE_URL` pointant sur la
base de production.

**Ordre à respecter quand une migration change une colonne utilisée en
production** : appliquer d'abord la migration additive (le code en ligne
continue de fonctionner), déployer, puis appliquer la migration qui rend la
colonne obligatoire. C'est le cas de `002_beneficiaries` puis
`003_beneficiary_required` : la seconde rattrape les transmissions enregistrées
par l'ancien code pendant le déploiement.

`vercel.json` déclare une tâche quotidienne à 3 h qui rejoue les recopies Sheets
en attente, purge les sessions expirées et supprime les photos jamais validées.

---

## Utilisation quotidienne

1. Ouvrez l'application et connectez-vous, la session dure 30 jours.
2. Remplissez les 7 étapes. **La saisie est enregistrée sur l'appareil à chaque
   frappe** : vous pouvez fermer l'onglet, verrouiller le téléphone et reprendre
   plus tard dans la journée.
3. Ajoutez les photos au fil des étapes. Chacune part immédiatement, une par une.
4. À la dernière étape, validez. Les données sont enregistrées avant toute autre
   opération.
5. Touchez **Envoyer sur WhatsApp**. Sur téléphone, le PDF et le message
   partent ensemble vers le partage du système : vous choisissez WhatsApp,
   puis le ou les contacts. Sur ordinateur, le PDF est téléchargé et WhatsApp
   s’ouvre avec le message ; il reste à joindre le fichier.

Le message d’accompagnement est aussi copié dans le presse-papiers : WhatsApp
ne reprend pas toujours le texte qui accompagne un document, il suffit alors de
le coller.

Si la connexion lâche pendant l'envoi, renvoyez simplement le formulaire :
la référence du brouillon empêche la création d'une deuxième ligne.

---

## Tests

```bash
npm test
```

69 tests hors ligne : schéma, validation, règles d'accès, résumé, export CSV
(échappement, virgule décimale, formules neutralisées), PDF (accents,
mention sur chaque page, absence de page blanche) et contrat HTTP
(authentification, CSRF, format des réponses d'erreur). Ils ne touchent jamais la
base, `tests/setup.js` fixe `DATABASE_URL` sur un port fermé.

```bash
npm run check:db
```

Contrôle d'intégration contre la vraie base, **à lancer avant chaque mise en
production**. Il déroule le parcours complet (connexion, photo, enregistrement,
idempotence, PDF) et éprouve le cloisonnement : deux familles, deux personnes,
chacune doit rester aveugle aux transmissions, aux PDF et aux photos de l'autre.
Il efface ensuite tout ce qu'il a créé, y compris dans la feuille Google.

Il force le pool à **une seule connexion**, comme en environnement serverless.
Cette contrainte n'est pas cosmétique : elle a révélé un interblocage invisible
en local, où une transaction détenait l'unique connexion pendant qu'une requête
en réclamait une autre au pool. Ne relevez pas cette limite pour faire passer le
contrôle.

---

## Ce qui a changé depuis la version 1

| Problème constaté | Cause | Correction |
|---|---|---|
| Données enregistrées sans PDF, puis doublons | Sheets était écrit **avant** la génération du PDF ; un échec laissait une ligne orpheline et l'aidante renvoyait le formulaire | Le PDF est produit à la demande depuis la ligne enregistrée, via `GET /api/transmissions/:id/pdf`. Une référence de brouillon rend l'envoi idempotent |
| Formulaire qui « bug » avec des photos | Toutes les images partaient en base64 dans un seul POST ; au-delà de 4,5 Mo, Vercel rejetait la requête avant le code applicatif | Une requête par photo, compression visant une taille cible, et limite globale vérifiée avant l'envoi |
| Messages d'erreur incompréhensibles | `response.json()` sans garde sur une réponse HTML (413, 504, page d'erreur) | Toute route `/api` répond en JSON, et le client traduit chaque code en message français |
| Saisie perdue | Aucune sauvegarde locale | Brouillon enregistré à chaque frappe et restauré au chargement |
| Champs masqués enregistrés quand même | Les conditions n'existaient que dans le HTML | Les conditions sont dans le schéma, appliquées côté client **et** serveur, en cascade |
| Feuille Google modifiable par n'importe qui | Aucune authentification | Sessions, mots de passe hachés (scrypt), rôles, contrôle d'origine |
| Limitation de débit inopérante | Compteur en mémoire, remis à zéro à chaque instance serverless | Compteur partagé en base |
| Détails techniques renvoyés au client | `error.message` brut de l'API Google | Seuls les messages destinés à l'utilisateur sortent ; le reste est journalisé |
| Historique partagé entre familles | Aucun lien entre un compte et la personne suivie : un compte famille voyait toutes les transmissions, photos comprises | Fiches « personne accompagnée », rattachement par compte, filtrage en SQL, contrôle sur le PDF et chaque photo |

---

## Export CSV

Depuis la page **Administration**, le bouton **CSV** d’une personne télécharge
toutes ses transmissions, une ligne par journée, pour en tirer des courbes
(poids, tension, glycémie, humeur) dans un tableur.

Réservé à l’administration : c’est le dossier complet d’une personne dans un
seul fichier. Le numéro WhatsApp du destinataire en est exclu.

Conventions françaises : séparateur point-virgule, virgule décimale, BOM en
tête. Le fichier s’ouvre directement dans Excel, Google Sheets et LibreOffice,
accents compris. Une valeur commençant par `=`, `+` ou `@` est neutralisée par
une apostrophe, sans quoi le tableur l’exécuterait comme une formule.

Filtre de période possible sur la route :
`/api/admin/beneficiaries/<id>/export.csv?from=2026-01-01&to=2026-03-31`.

---

## Identité visuelle

Univers « soin et douceur » : fond crème, vert profond pour l’action, abricot
pour l’attention, paysage de collines en en-tête. Titres en **Fraunces**, texte
en **Nunito Sans**. Thème clair et sombre suivant le réglage du téléphone.

Rapports de contraste mesurés dans le navigateur (seuil d’accessibilité : 4,5:1) :

| Paire | Clair | Sombre |
|---|---|---|
| Texte principal sur carte | 14,8 | 13,4 |
| Texte secondaire sur carte | 5,8 | 7,6 |
| Unités et textes indicatifs | 4,75 | 4,5 |
| Bouton principal | 7,8 | 9,2 |
| Abricot sur fond d’en-tête | 5,8 | 9,2 |
| Messages d’erreur | 5,7 | 7,5 |

L’en-tête illustré a été contrôlé à 375, 820, 1024, 1280 et 1920 px : aucun
élément du dessin ne chevauche le texte ni n’est rogné.

### Mention « by Prime Advisors SB, Inc. »

Elle apparaît en pied de chaque écran, connexion comprise, et en pied de chaque
page du PDF, toujours cliquable vers https://www.primeadvisors-sb.com/. En
texte seul : le logo demanderait une requête vers un site tiers depuis une
application de santé, et se briserait si son adresse changeait.
