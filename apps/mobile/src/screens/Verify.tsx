import { useCallback, useEffect, useState } from 'react';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { api } from '../api';
import { Body, Button, Card, Disclaimer, H1, Screen, Toggle } from '../components/ui';
import { pick, useLang } from '../i18n';

export default function Verify({ route }: { route: { params: { logId: string; activityId: string } } }) {
  const { t, td, lang } = useLang();
  const { logId, activityId } = route.params;
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [task, setTask] = useState<any | null | undefined>(undefined);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [subs, setSubs] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ tone?: 'ok' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSubs = useCallback(async () => { try { setSubs((await api<{ submissions: any[] }>('/verification/submissions')).submissions.filter((s) => s.log_id === logId)); } catch { /* offline */ } }, [logId]);
  useEffect(() => {
    api(`/scripture-tasks/${activityId}`).then(setTask).catch(() => setTask(null));
    api<{ consents: any[] }>('/me/consents').then((c) => setConsent(c.consents.some((x) => x.type === 'evidence' && !x.revoked_at))).catch(() => {});
    void loadSubs();
  }, [activityId, loadSubs]);

  const start = async () => {
    const p = await requestRecordingPermissionsAsync();
    if (!p.granted) { setMsg({ tone: 'warn', text: t('common.error') }); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true); setUri(null);
  };
  const stop = async () => { await recorder.stop(); setRecording(false); setUri(recorder.uri); };
  const send = async () => {
    if (!uri) return;
    setBusy(true);
    try {
      await api('/me/consents', { json: { type: 'evidence', granted: true } });
      const form = new FormData();
      form.append('logId', logId); // fields must precede the file
      form.append('file', { uri, name: 'recitation.m4a', type: 'audio/mp4' } as any);
      await api('/verification/submissions', { form });
      setMsg({ tone: 'ok', text: t('verify.sent') }); setUri(null); await loadSubs();
    } catch (e: any) { setMsg({ tone: 'warn', text: e.code === 'duplicate_submission' ? t('common.error') + ' (duplicate)' : t('common.error') }); }
    setBusy(false);
  };
  const appeal = async (id: string) => { try { await api(`/verification/submissions/${id}/appeal`, { json: {} }); setMsg({ tone: 'ok', text: t('verify.appealSent') }); await loadSubs(); } catch { setMsg({ tone: 'warn', text: t('common.error') }); } };

  return (
    <Screen>
      <H1>{t('verify.title')}</H1>
      {task === undefined && <Body muted>{t('common.loading')}</Body>}
      {task === null && <Body muted>{t('verify.unavailable')}</Body>}
      {task && (
        <>
          <Card>
            <Body>{pick(lang, task.title_en, task.title_ar)}</Body>
            <Body muted small>{task.passage_ref} · {task.reference_edition}</Body>
            {task.permitted_variations ? <Body muted small>{task.permitted_variations}</Body> : null}
          </Card>
          <Body>{t('verify.explain')}</Body>
          <Toggle label={t('verify.consent')} value={consent} onChange={setConsent} />
          {!recording ? <Button title={t('verify.record')} onPress={start} disabled={!consent} /> : <Button kind="danger" title={t('verify.stop')} onPress={stop} />}
          {uri && <Button title={t('verify.send')} onPress={send} busy={busy} />}
          {msg && <Body tone={msg.tone}>{msg.text}</Body>}
          {subs.map((s) => (
            <Card key={s.id}>
              <Body>{td(`status.${s.status === 'pending_review' ? 'pending_review' : s.status}`)}</Body>
              {(s.status === 'unable_to_verify' || s.status === 'rejected') && !s.appeal_status && s.evidence_stored && <Button kind="secondary" title={t('verify.appeal')} onPress={() => appeal(s.id)} />}
              {s.status === 'unable_to_verify' && <Body muted small>{t('verify.neverRejected')}</Body>}
            </Card>
          ))}
        </>
      )}
      <Disclaimer kind="verification" />
    </Screen>
  );
}
