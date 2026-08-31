# Transmission — suivi quotidien à domicile

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
  domain/schema.js      Source unique des champs — pilote le formulaire,
                        la validation, le PDF, le message et l'en-tête Sheets
  domain/validate.js    Validation serveur, effacement des champs masqués
  auth/                 Mots de passe (scrypt), sessions en base, rôles, CSRF
  db/                   Pool Postgres, migrations SQL
  repositories/         Accès aux tables, sans logique métier
  services/             Orchestration : transmissions, PDF, message, miroir Sheets
  routes/               Points d'entrée HTTP
  app.js                Assemblage Express
public/
  index.html            Formulaire en 7 étapes
  login.html            Connexion
  historique.html       Consultation et retéléchargement des PDF
  js/                   Modules ES natifs, sans dépendance ni build
tests/                  Tests de domaine et de contrat HTTP
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

Les trois rôles :

| Rôle      | Peut faire                                                |
|-----------|-----------------------------------------------------------|
| `aidant`  | Saisir une transmission, consulter les siennes            |
| `famille` | Consulter toutes les transmissions et télécharger les PDF |
| `admin`   | Tout, plus la gestion des comptes                         |

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

`vercel.json` déclare une tâche quotidienne à 3 h qui rejoue les recopies Sheets
en attente, purge les sessions expirées et supprime les photos jamais validées.

---

## Utilisation quotidienne

1. Ouvrez l'application et connectez-vous — la session dure 30 jours.
2. Remplissez les 7 étapes. **La saisie est enregistrée sur l'appareil à chaque
   frappe** : vous pouvez fermer l'onglet, verrouiller le téléphone et reprendre
   plus tard dans la journée.
3. Ajoutez les photos au fil des étapes. Chacune part immédiatement, une par une.
4. À la dernière étape, validez. Les données sont enregistrées avant toute autre
   opération.
5. Téléchargez le PDF, puis ouvrez WhatsApp et envoyez-le vous-même.

Si la connexion lâche pendant l'envoi, renvoyez simplement le formulaire :
la référence du brouillon empêche la création d'une deuxième ligne.

---

## Tests

```bash
npm test
```

43 tests, sans base de données requise : schéma, validation, résumé, génération
PDF, et contrat HTTP (authentification, CSRF, format des réponses d'erreur).

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
