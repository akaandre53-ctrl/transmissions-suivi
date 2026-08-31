/**
 * Crée un compte depuis le terminal.
 *
 *   npm run create-user -- --email marie@exemple.ci --nom "Marie Koffi" --role aidant
 *
 * Le mot de passe est demandé sans être affiché. Sans --motdepasse ni saisie
 * interactive, un mot de passe solide est généré et affiché une seule fois.
 */
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth/password.js';
import { closePool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import * as users from '../src/repositories/users.repo.js';

const ROLES = ['admin', 'aidant', 'famille'];

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? (index += 1, next) : 'true';
  }
  return args;
}

/** Demande une valeur sans l'afficher à l'écran. */
function askHidden(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    // readline réécrit normalement chaque caractère frappé : on masque tout
    // ce qui suit l'invite, sans gérer nous-mêmes les touches spéciales.
    rl._writeToOutput = chunk => {
      if (!muted) rl.output.write(chunk);
    };
    rl.question(question, answer => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const email = (args.email || '').trim();
  const fullName = (args.nom || args.name || '').trim();
  const role = (args.role || 'aidant').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Adresse e-mail manquante ou invalide. Utilisez --email');
  }
  if (fullName.length < 2) throw new Error('Nom manquant. Utilisez --nom "Prénom Nom"');
  if (!ROLES.includes(role)) throw new Error(`Rôle inconnu. Valeurs possibles : ${ROLES.join(', ')}`);

  // Garantit que les tables existent, y compris au tout premier lancement.
  await runMigrations({ log: () => {} });

  if (await users.findByEmail(email)) {
    throw new Error(`Un compte existe déjà avec l'adresse ${email}.`);
  }

  let password = args.motdepasse || args.password || '';
  let generated = false;
  if (!password && process.stdin.isTTY) {
    password = await askHidden('Mot de passe (10 caractères minimum) : ');
  }
  if (!password) {
    password = randomBytes(12).toString('base64url');
    generated = true;
  }
  if (password.length < 10) throw new Error('Le mot de passe doit contenir au moins 10 caractères.');

  const user = await users.create({
    email, fullName, role, passwordHash: await hashPassword(password)
  });

  console.log('\nCompte créé.');
  console.log(`  Nom    : ${user.full_name}`);
  console.log(`  E-mail : ${user.email}`);
  console.log(`  Rôle   : ${user.role}`);
  if (generated) {
    console.log(`  Mot de passe : ${password}`);
    console.log('\n  Notez-le maintenant : il ne sera plus affiché.');
  }
  const total = await users.countAll();
  if (total === 1) {
    console.log('\nC’est le premier compte. Pensez à en créer un de rôle « admin » si ce n’est pas celui-ci.');
  }
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async error => {
    console.error(`\nÉchec : ${error.message}`);
    await closePool().catch(() => {});
    process.exit(1);
  });
