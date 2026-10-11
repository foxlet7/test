import { SEEDS } from '@gdc/shared';
import type { Db } from '../db';

export { SEEDS };

export async function seedCatalogue(db: Db): Promise<number> {
  let n = 0;
  for (const s of SEEDS) {
    const ex = await db.query('select 1 from activity_definitions where id = $1', [s.id]);
    if (ex.rows.length) continue;
    await db.tx(async (t) => {
      await t.query('insert into activity_definitions(id, tradition, category, type, obligation_class, verification_class) values ($1,$2,$3,$4,$5,$6)',
        [s.id, s.tradition, s.category, s.type, s.obligation, s.vclass]);
      await t.query(
        `insert into activity_versions(activity_id, version, base_points, repeat_policy, title_en, title_ar, description_en, description_ar, notes_en, notes_ar, religious_references, status)
         values ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft')`,
        [s.id, s.points, JSON.stringify(s.repeat), s.en[0], s.ar[0], s.en[1], s.ar[1], s.notesEn ?? null, s.notesAr ?? null,
         JSON.stringify((s.refs ?? []).map((r) => ({ ...r, verified: false })))]);
      n++;
    });
  }
  return n;
}
