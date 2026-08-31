import { createApp } from './src/app.js';
import { config, describeConfig } from './src/config.js';

const app = createApp();
export default app;

if (!config.isServerless) {
  const { problems, warnings } = describeConfig();
  for (const warning of warnings) console.warn(`Attention : ${warning}`);
  if (problems.length) {
    for (const problem of problems) console.error(`Erreur : ${problem}`);
    console.error('\nCopiez .env.example vers .env et renseignez DATABASE_URL, puis relancez.');
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`Application ouverte sur http://localhost:${config.port}`);
  });
}
