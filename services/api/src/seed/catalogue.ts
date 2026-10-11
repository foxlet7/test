import type { RepeatPolicy, Tradition, Category, ObligationClass, VerificationClass } from '@gdc/shared';
import type { Db } from '../db';

/**
 * DRAFT catalogue structure. Every entry is seeded as `draft` with machine-drafted Arabic.
 * Nothing becomes user-visible until qualified reviewers approve it in the admin dashboard.
 * Point values are illustrative product-design values, NOT religious valuations.
 * References are starting points that reviewers must verify (verified: false).
 */
interface Seed {
  id: string; tradition: Tradition; category: Category; type: 'recurring' | 'milestone' | 'event' | 'measurable';
  obligation: ObligationClass; vclass: VerificationClass; points: number; repeat: RepeatPolicy;
  en: [string, string]; ar: [string, string]; notesEn?: string; notesAr?: string;
  refs?: { label: string; source: string }[];
}

const day = (max: number): RepeatPolicy => ({ kind: 'per_day', max });
const week = (max: number): RepeatPolicy => ({ kind: 'per_week', max });
const milestone: RepeatPolicy = { kind: 'per_milestone' };
const NO_AMOUNT_EN = 'Only the act is recorded. Amounts are never recorded and never change your points.';
const NO_AMOUNT_AR = 'يُسجَّل العمل فقط. لا تُسجَّل المبالغ ولا تغيّر نقاطك أبدًا.';

export const SEEDS: Seed[] = [
  // ---- Islam ----
  { id: 'islam.worship.obligatory_prayer', tradition: 'islam', category: 'worship', type: 'recurring', obligation: 'obligatory', vclass: 'A', points: 3, repeat: day(5),
    en: ['Perform an obligatory prayer', 'Record that you performed one of the obligatory prayers.'], ar: ['أداء صلاة مفروضة', 'سجّل أنك أدّيت إحدى الصلوات المفروضة.'],
    notesEn: 'Private self-log only. The app does not assess the quality of any prayer.', notesAr: 'تسجيل ذاتي خاص فقط. لا يقيّم التطبيق جودة أي صلاة.' },
  { id: 'islam.worship.voluntary_prayer', tradition: 'islam', category: 'worship', type: 'recurring', obligation: 'voluntary', vclass: 'A', points: 3, repeat: day(5),
    en: ['Perform a voluntary prayer', 'Record a voluntary (nafl) prayer.'], ar: ['أداء صلاة تطوع', 'سجّل صلاة نافلة.'] },
  { id: 'islam.worship.dhikr', tradition: 'islam', category: 'worship', type: 'recurring', obligation: 'voluntary', vclass: 'A', points: 3, repeat: day(3),
    en: ['Remembrance (dhikr)', 'Record a session of remembrance of God.'], ar: ['ذكر الله', 'سجّل جلسة ذكر لله.'] },
  { id: 'islam.quran.read_session', tradition: 'islam', category: 'learning', type: 'recurring', obligation: 'voluntary', vclass: 'A', points: 5, repeat: day(3),
    en: ['Qur’an reading session', 'Record a session of reading or studying the Qur’an.'], ar: ['جلسة قراءة القرآن', 'سجّل جلسة قراءة أو دراسة للقرآن الكريم.'] },
  { id: 'islam.quran.memorize_milestone', tradition: 'islam', category: 'learning', type: 'milestone', obligation: 'voluntary', vclass: 'B', points: 15, repeat: milestone,
    en: ['Qur’an memorization milestone', 'Record a completed memorization milestone (for example, a passage you finished). Optional recitation verification is available when a reviewed task exists.'],
    ar: ['إنجاز في حفظ القرآن', 'سجّل إنجازًا مكتملًا في الحفظ (مثل مقطع أتممته). يتوفر التحقق الاختياري بالتلاوة عند وجود مهمة معتمدة.'],
    notesEn: 'Verification, when available, checks only the published criteria for the selected passage; it does not assess tajwid unless reviewers explicitly define that.',
    notesAr: 'يفحص التحقق، عند توفره، المعايير المنشورة للمقطع المحدد فقط، ولا يقيّم التجويد ما لم يحدده المراجعون صراحةً.' },
  { id: 'islam.quran.review_session', tradition: 'islam', category: 'learning', type: 'recurring', obligation: 'voluntary', vclass: 'A', points: 5, repeat: day(2),
    en: ['Review memorized passages', 'Record a review session of previously memorized material.'], ar: ['مراجعة المحفوظ', 'سجّل جلسة مراجعة لما حفظته سابقًا.'] },
  { id: 'islam.charity.sadaqa', tradition: 'islam', category: 'charity', type: 'event', obligation: 'voluntary', vclass: 'A', points: 5, repeat: day(3),
    en: ['Give voluntary charity (sadaqa)', 'Record giving voluntary charity, in any form.'], ar: ['صدقة تطوعية', 'سجّل تقديم صدقة تطوعية بأي صورة.'], notesEn: NO_AMOUNT_EN, notesAr: NO_AMOUNT_AR,
    refs: [{ label: 'Charity (to be verified by reviewers)', source: 'Qur’an 2:261–271' }] },
  { id: 'islam.charity.feed_someone', tradition: 'islam', category: 'charity', type: 'event', obligation: 'voluntary', vclass: 'A', points: 5, repeat: day(2),
    en: ['Feed someone in need', 'Record feeding a person in need.'], ar: ['إطعام محتاج', 'سجّل إطعام شخص محتاج.'], notesEn: NO_AMOUNT_EN, notesAr: NO_AMOUNT_AR },
  { id: 'islam.charity.zakat', tradition: 'islam', category: 'charity', type: 'milestone', obligation: 'obligatory', vclass: 'A', points: 5, repeat: milestone,
    en: ['Fulfil zakat (obligatory)', 'Record that you fulfilled your zakat for a year (use the year as the milestone).'], ar: ['أداء الزكاة (واجبة)', 'سجّل أنك أدّيت زكاتك عن سنة (استخدم السنة كإنجاز).'],
    notesEn: 'Zakat is obligatory and has specific rules; it is separate from voluntary sadaqa. Ask a qualified scholar about your situation. Amounts are never recorded.',
    notesAr: 'الزكاة واجبة ولها أحكام خاصة، وهي مستقلة عن الصدقة التطوعية. اسأل عالمًا مؤهلًا عن حالتك. لا تُسجَّل المبالغ أبدًا.' },
  { id: 'islam.character.parents', tradition: 'islam', category: 'character', type: 'recurring', obligation: 'general_good_deed', vclass: 'A', points: 5, repeat: day(1),
    en: ['Kindness to parents', 'Record an act of kindness or service to your parents.'], ar: ['البرّ بالوالدين', 'سجّل عملًا من البرّ أو الخدمة لوالديك.'] },
  { id: 'islam.character.family_ties', tradition: 'islam', category: 'character', type: 'recurring', obligation: 'general_good_deed', vclass: 'A', points: 5, repeat: week(3),
    en: ['Maintain family ties', 'Record reaching out to or helping a relative.'], ar: ['صلة الرحم', 'سجّل التواصل مع قريب أو مساعدته.'] },
  { id: 'islam.character.help_neighbor', tradition: 'islam', category: 'character', type: 'event', obligation: 'general_good_deed', vclass: 'A', points: 5, repeat: day(2),
    en: ['Help a neighbor or someone in need', 'Record a private act of help or kindness.'], ar: ['مساعدة جار أو محتاج', 'سجّل عمل مساعدة أو لطف خاص.'] },
  { id: 'islam.character.reconcile', tradition: 'islam', category: 'character', type: 'event', obligation: 'general_good_deed', vclass: 'A', points: 5, repeat: week(2),
    en: ['Reconcile or forgive', 'Record an act of reconciliation or forgiveness.'], ar: ['الإصلاح أو العفو', 'سجّل عمل إصلاح أو عفو.'] },
  { id: 'islam.service.volunteer_session', tradition: 'islam', category: 'service', type: 'event', obligation: 'general_good_deed', vclass: 'C', points: 15, repeat: day(2),
    en: ['Volunteering session', 'Record a volunteering session. Hours are not scored separately.'], ar: ['جلسة تطوع', 'سجّل جلسة تطوع. لا تُحتسب الساعات بشكل منفصل.'] },
  // ---- Christianity ----
  { id: 'christianity.bible.read_session', tradition: 'christianity', category: 'learning', type: 'recurring', obligation: 'voluntary', vclass: 'A', points: 5, repeat: day(3),
    en: ['Scripture reading or study', 'Record a session of reading or studying the Bible.'], ar: ['قراءة أو دراسة الكتاب المقدس', 'سجّل جلسة قراءة أو دراسة للكتاب المقدس.'],
    notesEn: 'Traditions differ in which books and translations they use; choose what your community uses.', notesAr: 'تختلف التقاليد في الأسفار والترجمات المستخدمة؛ اختر ما تستخدمه جماعتك.' },
  { id: 'christianity.bible.memorize_milestone', tradition: 'christianity', category: 'learning', type: 'milestone', obligation: 'voluntary', vclass: 'B', points: 15, repeat: milestone,
    en: ['Scripture memorization milestone', 'Record a completed memorization milestone (for example, a passage you finished). Optional recitation verification is available when a reviewed task exists.'],
    ar: ['إنجاز في حفظ الكتاب المقدس', 'سجّل إنجازًا مكتملًا في الحفظ (مثل مقطع أتممته). يتوفر التحقق الاختياري بالتلاوة عند وجود مهمة معتمدة.'],
    notesEn: 'Translations differ across traditions; reviewers define which edition(s) a verification task accepts, and no single translation is treated as the only legitimate one.',
    notesAr: 'تختلف الترجمات بين التقاليد؛ يحدد المراجعون الطبعات المقبولة في كل مهمة تحقق، ولا تُعدّ ترجمة واحدة هي الوحيدة المشروعة.' },
  { id: 'christianity.prayer.personal', tradition: 'christianity', category: 'worship', type: 'recurring', obligation: 'voluntary', vclass: 'A', points: 3, repeat: day(5),
    en: ['Personal prayer', 'Record a time of personal prayer.'], ar: ['صلاة شخصية', 'سجّل وقتًا من الصلاة الشخصية.'], notesEn: 'Private self-log only.', notesAr: 'تسجيل ذاتي خاص فقط.' },
  { id: 'christianity.prayer.devotion', tradition: 'christianity', category: 'worship', type: 'recurring', obligation: 'voluntary', vclass: 'A', points: 3, repeat: day(2),
    en: ['Devotional practice or reflection', 'Record a devotional or reflective practice from your tradition.'], ar: ['ممارسة تعبدية أو تأمل', 'سجّل ممارسة تعبدية أو تأملية من تقليدك.'],
    notesEn: 'Sacramental practices differ among Catholic, Orthodox and Protestant traditions and are not scored as if universal.', notesAr: 'تختلف الممارسات الأسرارية بين الكاثوليكية والأرثوذكسية والبروتستانتية ولا تُحتسب كأنها عامة.' },
  { id: 'christianity.charity.give', tradition: 'christianity', category: 'charity', type: 'event', obligation: 'voluntary', vclass: 'A', points: 5, repeat: day(3),
    en: ['Give to those in need', 'Record giving or donating to help others.'], ar: ['العطاء للمحتاجين', 'سجّل عطاءً أو تبرعًا لمساعدة الآخرين.'], notesEn: NO_AMOUNT_EN, notesAr: NO_AMOUNT_AR,
    refs: [{ label: 'Faith and works (to be verified by reviewers)', source: 'James 2:14–17' }, { label: 'Private giving (to be verified by reviewers)', source: 'Matthew 6:1–4' }] },
  { id: 'christianity.charity.feed_someone', tradition: 'christianity', category: 'charity', type: 'event', obligation: 'general_good_deed', vclass: 'A', points: 5, repeat: day(2),
    en: ['Feed someone in need', 'Record feeding a person in need.'], ar: ['إطعام محتاج', 'سجّل إطعام شخص محتاج.'], notesEn: NO_AMOUNT_EN, notesAr: NO_AMOUNT_AR },
  { id: 'christianity.character.forgive', tradition: 'christianity', category: 'character', type: 'event', obligation: 'general_good_deed', vclass: 'A', points: 5, repeat: week(3),
    en: ['Forgive or reconcile', 'Record an act of forgiveness or reconciliation.'], ar: ['الغفران أو المصالحة', 'سجّل عمل غفران أو مصالحة.'] },
  { id: 'christianity.character.family_support', tradition: 'christianity', category: 'character', type: 'recurring', obligation: 'general_good_deed', vclass: 'A', points: 5, repeat: day(2),
    en: ['Support a family member', 'Record caring for or supporting a family member.'], ar: ['دعم أحد أفراد الأسرة', 'سجّل رعاية أو دعم أحد أفراد أسرتك.'] },
  { id: 'christianity.character.visit', tradition: 'christianity', category: 'character', type: 'event', obligation: 'general_good_deed', vclass: 'A', points: 5, repeat: week(3),
    en: ['Visit someone who is sick or lonely', 'Record visiting or checking in on someone in need of company.'], ar: ['زيارة مريض أو وحيد', 'سجّل زيارة أو الاطمئنان على شخص يحتاج إلى رفقة.'] },
  { id: 'christianity.character.help_neighbor', tradition: 'christianity', category: 'character', type: 'event', obligation: 'general_good_deed', vclass: 'A', points: 5, repeat: day(2),
    en: ['Help a neighbor or someone in need', 'Record a private act of help or kindness.'], ar: ['مساعدة جار أو محتاج', 'سجّل عمل مساعدة أو لطف خاص.'] },
  { id: 'christianity.service.volunteer_session', tradition: 'christianity', category: 'service', type: 'event', obligation: 'general_good_deed', vclass: 'C', points: 15, repeat: day(2),
    en: ['Volunteering session', 'Record a volunteering session. Hours are not scored separately.'], ar: ['جلسة تطوع', 'سجّل جلسة تطوع. لا تُحتسب الساعات بشكل منفصل.'] },
];

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
