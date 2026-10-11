import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CATEGORIES } from '@gdc/shared';
import { ApiError, api } from '../api';
import { Body, Button, Card, Chip, Disclaimer, Field, H1, Row, Screen } from '../components/ui';
import { errorKey, pick, useLang } from '../i18n';

const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
export const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

export default function Log() {
  const { t, td, lang } = useLang();
  const nav = useNavigation<any>();
  const [items, setItems] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [sel, setSel] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [milestone, setMilestone] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; logId?: string; verifiable?: boolean } | null>(null);
  const idem = useRef(newKey()); // stable per attempt: a retry after a network drop cannot double-award

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(); if (q) qs.set('q', q); if (cat) qs.set('category', cat);
      setItems((await api<{ items: any[] }>(`/catalogue?${qs}`)).items);
    } catch { setItems([]); }
  }, [q, cat]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);

  const open = (it: any) => { setSel(it); setNote(''); setMilestone(''); setResult(null); idem.current = newKey(); };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<any>('/logs', { json: { activityId: sel.id, localDate: localDate(), tz: deviceTz(), note: note || null, milestoneKey: sel.repeat_policy.kind === 'per_milestone' ? milestone.trim() : null, idempotencyKey: idem.current } });
      setResult({ ok: true, logId: r.logId, verifiable: sel.verifiable, text: r.pointsAwarded > 0 ? t('log.earned', { points: r.pointsAwarded }) : t('log.earnedZero') });
    } catch (e) {
      setResult({ ok: false, text: t(errorKey(e instanceof ApiError ? e.code : 'error')) });
    }
    setBusy(false);
  };
  const report = async () => { try { await api('/reports', { json: { kind: 'content_error', target: sel.id, message: 'Reported from app' } }); setResult({ ok: true, text: t('log.reportSent') }); } catch { /* ignore */ } };

  return (
    <Screen>
      <H1>{t('log.title')}</H1>
      <Field label={t('log.search')} value={q} onChangeText={setQ} />
      <Row>
        <Chip title="•" selected={cat === null} onPress={() => setCat(null)} />
        {CATEGORIES.map((c) => <Chip key={c} title={td(`category.${c}`)} selected={cat === c} onPress={() => setCat(c)} />)}
      </Row>
      {items?.length === 0 && <Body muted>{t('log.noneYet')}</Body>}
      {items?.map((it) => (
        <Card key={it.id} onPress={() => open(it)} label={pick(lang, it.title_en, it.title_ar)}>
          <Body>{pick(lang, it.title_en, it.title_ar)}</Body>
          <Body muted small>{td(`log.${it.obligation_class}`)} · +{it.base_points}</Body>
        </Card>
      ))}
      <Disclaimer kind="content" />

      <Modal visible={!!sel} animationType="slide" onRequestClose={() => setSel(null)}>
        <Screen>
          {sel && (
            <>
              <H1>{pick(lang, sel.title_en, sel.title_ar)}</H1>
              <Body muted small>{td(`log.${sel.obligation_class}`)}</Body>
              <Body>{pick(lang, sel.description_en, sel.description_ar)}</Body>
              {(sel.notes_en || sel.notes_ar) && <Card><Body small>{pick(lang, sel.notes_en, sel.notes_ar)}</Body></Card>}
              {sel.religious_references?.length > 0 && (
                <View>{sel.religious_references.map((r: any, i: number) => <Body key={i} muted small>{r.source}{r.verified ? '' : ' •'}</Body>)}</View>
              )}
              {sel.repeat_policy.kind === 'per_milestone' && <Field label={t('log.milestone')} value={milestone} onChangeText={setMilestone} />}
              <Field label={t('log.note')} value={note} onChangeText={setNote} multiline />
              {result ? (
                <Card>
                  <Body tone={result.ok ? 'ok' : 'warn'}>{result.text}</Body>
                  {result.ok && result.logId && <Body muted small>{result.verifiable ? t('log.countsBoth') : t('log.countsA')}</Body>}
                  {result.ok && result.verifiable && result.logId && <Button kind="secondary" title={t('verify.title')} onPress={() => { const id = result.logId; const act = sel.id; setSel(null); nav.navigate('Verify', { logId: id, activityId: act }); }} />}
                </Card>
              ) : <Button title={t('log.save')} onPress={submit} busy={busy} disabled={sel.repeat_policy.kind === 'per_milestone' && !milestone.trim()} />}
              <Button kind="secondary" title={t('common.back')} onPress={() => { setSel(null); void load(); }} />
              <Body muted small onPress={report}>{t('log.reportError')}</Body>
              <Disclaimer kind="points" />
            </>
          )}
        </Screen>
      </Modal>
    </Screen>
  );
}
