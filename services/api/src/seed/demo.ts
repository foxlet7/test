// Development-only: seeds an APPROVED demo catalogue so the apps can be exercised end to end.
// Real deployments must have qualified reviewers approve content in the admin dashboard.
import { loadConfig } from '../config';
import { openDb } from '../db';
import { bootstrap } from '../bootstrap';
import { seedCatalogue } from './catalogue';
import { createStaff } from './staff';

const cfg = loadConfig();
if (cfg.env === 'production') throw new Error('Refusing to run demo seed in production');
const db = await openDb(cfg);
await bootstrap(db);
await seedCatalogue(db);

const pw = 'demo-password-123';
const admin = await createStaff(db, 'admin@demo.local', pw, 'demo_admin', ['super_admin']);
await createStaff(db, 'content@demo.local', pw, 'demo_content', ['content_admin']);
await createStaff(db, 'translation@demo.local', pw, 'demo_translation', ['translation_reviewer']);
const imam = await createStaff(db, 'islam.reviewer@demo.local', pw, 'demo_islam_reviewer', ['islamic_reviewer', 'verification_reviewer']);
const pastor = await createStaff(db, 'christian.reviewer@demo.local', pw, 'demo_christian_reviewer', ['christian_reviewer', 'verification_reviewer']);
await createStaff(db, 'mod@demo.local', pw, 'demo_mod', ['moderator']);
await createStaff(db, 'auditor@demo.local', pw, 'demo_auditor', ['auditor']);

for (const [tradition, reviewer] of [['islam', imam], ['christianity', pastor]] as const) {
  await db.query(
    `update activity_versions v set status='approved', translation_status='reviewed', approved_by=$2, approved_at=now()
       from activity_definitions d where d.id = v.activity_id and d.tradition = $1 and v.status = 'draft'`, [tradition, reviewer]);
}
const tasks: [string, string, string][] = [
  ['demo-islam-task', 'islam.quran.memorize_milestone', 'islam'],
  ['demo-christianity-task', 'christianity.bible.memorize_milestone', 'christianity'],
];
for (const [id, activity, tradition] of tasks) {
  await db.query(
    `insert into scripture_tasks(id, activity_id, tradition, title_en, title_ar, passage_ref, reference_edition, permitted_variations, rubric, status, approved_by, approved_at)
     values ($1,$2,$3,'DEMO recitation task','مهمة تلاوة تجريبية','DEMO — reviewers set the real passage','DEMO — reviewers set the real edition','DEMO',$4,'approved',$5,now())
     on conflict (id) do nothing`,
    [id, activity, tradition, JSON.stringify([{ criterion: 'Words match the approved reference text', required: true }]), tradition === 'islam' ? imam : pastor]);
}
await db.query("insert into invites(code, max_uses, stage, note) values ('DEMO-INVITE', 1000, 1, 'dev only') on conflict do nothing");
console.log('Demo data ready.');
console.log('Staff logins (password "%s"): admin@demo.local, content@demo.local, translation@demo.local, islam.reviewer@demo.local, christian.reviewer@demo.local, mod@demo.local, auditor@demo.local', pw);
console.log('Invite code for app sign-up: DEMO-INVITE   (admin id %s)', admin);
await db.close();
