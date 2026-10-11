// Usage: STAFF_PASSWORD=... tsx src/seed/create-staff.ts email pseudonym role[,role...]
import { ROLES, type Role } from '@gdc/shared';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { bootstrap } from '../bootstrap';
import { createStaff } from './staff';

const [email, pseudonym, roleList] = process.argv.slice(2);
const password = process.env.STAFF_PASSWORD;
if (!email || !pseudonym || !roleList || !password || password.length < 12) {
  console.error('Usage: STAFF_PASSWORD=<12+ chars> create-staff <email> <pseudonym> <role,role>');
  process.exit(1);
}
const roles = roleList.split(',') as Role[];
for (const r of roles) if (!(ROLES as readonly string[]).includes(r)) { console.error(`Unknown role ${r}`); process.exit(1); }
const db = await openDb(loadConfig());
await bootstrap(db);
await createStaff(db, email, password, pseudonym, roles);
console.log(`Staff account ready: ${email} (${roles.join(', ')})`);
await db.close();
