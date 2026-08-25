# Transmission Maman

Application quotidienne Node.js + Express pour remplir une transmission, l'enregistrer dans Google Sheets, télécharger un PDF complet et ouvrir WhatsApp avec un résumé prêt à relire. Aucun message WhatsApp n'est envoyé automatiquement et aucune API WhatsApp payante n'est utilisée.

## Installation

1. Installez Node.js LTS.
2. Dans ce dossier, lancez `npm install`.
3. Copiez `.env.example` vers `.env`.
4. Dans `.env`, renseignez seulement ces deux valeurs :

```env
GOOGLE_SHEET_ID=votre_identifiant_de_feuille
GOOGLE_APPLICATION_CREDENTIALS=./google-service-account.json
```

Le fichier `google-service-account.json` doit être la clé du compte de service et ne doit jamais être publié. Créez un onglet nommé `Transmissions`, partagez la feuille avec l'adresse e-mail du compte de service avec le droit Editeur. Si l'onglet est vide, les titres de colonnes sont ajoutés automatiquement.

## Démarrage

```bash
npm start
```

Ouvrez ensuite http://localhost:3000.

## Chaque jour

1. Ouvrez l'application et vérifiez la date.
2. Remplissez les sections au fil de la journée. Les médicaments sont déjà préremplis ; corrigez-les seulement si nécessaire.
3. Saisissez le numéro WhatsApp au format international. Il est mémorisé localement dans le navigateur.
4. Ajoutez les photos du jour si besoin, puis validez le formulaire.
5. Le serveur enregistre la ligne dans `Transmissions`, le navigateur télécharge le PDF et ouvre WhatsApp avec le résumé.
6. Dans WhatsApp, joignez le PDF téléchargé, vérifiez le message, puis appuyez vous-même sur **Envoyer**.

Sans identifiants Google valides, le serveur démarre normalement mais l'enregistrement répondra avec une erreur de configuration ; cela permet de tester l'interface et le démarrage sans envoyer de données.
