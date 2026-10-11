import { buildApp } from './app';
import { bootstrap } from './bootstrap';
import { loadConfig } from './config';
import { openDb } from './db';
import { makeStore } from './services/evidenceStore';
import { runRetention } from './services/retention';

const cfg = loadConfig();
const db = await openDb(cfg);
await bootstrap(db);
const store = makeStore(cfg);
const app = await buildApp({ cfg, db, store, logger: true });

const timer = setInterval(() => {
  runRetention(db, store, new Date()).catch((e) => app.log.error({ msg: String(e?.message) }, 'retention failed'));
}, 60 * 60 * 1000);

const stop = async () => {
  clearInterval(timer);
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port: cfg.port, host: '0.0.0.0' });
