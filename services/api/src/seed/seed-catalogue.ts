// Seeds the DRAFT catalogue structure (idempotent). Nothing becomes visible to users until reviewers approve it.
import { bootstrap } from '../bootstrap';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { seedCatalogue } from './catalogue';

const db = await openDb(loadConfig());
await bootstrap(db);
console.log(`Seeded ${await seedCatalogue(db)} draft activities (existing ones were left untouched).`);
await db.close();
