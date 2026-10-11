import { useEffect, useState } from 'react';
import { Alert, Share } from 'react-native';
import * as Notifications from 'expo-notifications';
import { CONSENT_TYPES, TRADITIONS, type Language, type Tradition } from '@gdc/shared';
import { api } from '../api';
import { Body, Button, Card, Chip, Disclaimer, Field, H1, H2, Row, Screen, Toggle } from '../components/ui';
import { DEMO } from '../config';
import { useLang } from '../i18n';
import { useSession } from '../session';

export default function Me() {
  const { t, td, lang, setLang } = useLang();
  const { me, refreshMe, signOut } = useSession();
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [nick, setNick] = useState(me?.profile.pseudonym ?? '');
  const [goal, setGoal] = useState(String(me?.profile.weekly_goal ?? 5));
  const [reminder, setReminder] = useState(false);
  const [msg, setMsg] = useState('');

  const loadConsents = async () => {
    const c = await api<{ consents: { type: string; revoked_at: string | null }[] }>('/me/consents');
    const map: Record<string, boolean> = {};
    for (const x of c.consents) map[x.type] = !x.revoked_at;
    setActive(map);
  };
  useEffect(() => { void loadConsents().catch(() => {}); }, []);

  const patch = async (body: object) => { try { await api('/me/profile', { method: 'PATCH', json: body }); await refreshMe(); setMsg(''); } catch (e: any) { setMsg(e.code === 'pseudonym_taken' ? t('common.error') + ' (nickname taken)' : t('common.error')); } };
  const setConsent = async (type: string, granted: boolean) => { await api('/me/consents', { json: { type, granted } }); await loadConsents(); await refreshMe(); };

  // Gentle, opt-in daily reminder. No streak language, no guilt.
  const toggleReminder = async (on: boolean) => {
    setReminder(on);
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!on) return;
    const p = await Notifications.requestPermissionsAsync();
    if (!p.granted) { setReminder(false); return; }
    await Notifications.scheduleNotificationAsync({
      content: { title: t('app.name'), body: t('today.empty') },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 20, minute: 0 },
    });
  };

  const exportData = async () => { const d = await api('/me/export'); await Share.share({ message: JSON.stringify(d, null, 2) }); };
  const delEvidence = async () => { try { const r = await api<{ deleted: number }>('/me/evidence', { method: 'DELETE' }); setMsg(`${r.deleted}`); } catch { setMsg(t('common.error')); } };
  const delAccount = () => Alert.alert(t('me.delete'), t('me.deleteConfirm'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('common.delete'), style: 'destructive', onPress: async () => { await api('/me', { method: 'DELETE', json: { confirm: true } }); await signOut(); } },
  ]);

  return (
    <Screen>
      <H1>{t('me.title')}</H1>
      {DEMO && <Card><Body small tone="warn">{t('demo.banner')}</Body></Card>}
      <Card>
        <Field label={t('me.pseudonym')} value={nick} onChangeText={setNick} autoCapitalize="none" />
        <Button kind="secondary" title={t('common.save')} onPress={() => patch({ pseudonym: nick.trim() })} />
        <Body muted small>{t('me.language')}</Body>
        <Row>{(['en', 'ar'] as Language[]).map((l) => <Chip key={l} title={l === 'en' ? 'English' : 'العربية'} selected={lang === l} onPress={() => { setLang(l); void patch({ uiLanguage: l }); }} />)}</Row>
        <Body muted small>{t('me.tradition')}</Body>
        <Row>{TRADITIONS.map((tr) => <Chip key={tr} title={td(`tradition.${tr}`)} selected={me?.profile.tradition === tr} onPress={() => patch({ tradition: tr as Tradition })} />)}</Row>
        <Field label={t('me.goal')} value={goal} onChangeText={setGoal} keyboardType="number-pad" onEndEditing={() => { const n = parseInt(goal, 10); if (n >= 1 && n <= 100) void patch({ weeklyGoal: n }); }} />
      </Card>
      <H2>{t('me.consents')}</H2>
      {CONSENT_TYPES.filter((c) => c !== 'account').map((c) => <Toggle key={c} label={td(`consent.${c}`)} value={!!active[c]} onChange={(v) => setConsent(c, v)} />)}
      <Toggle label={t('tabs.today') + ' ⏰ 20:00'} value={reminder} onChange={toggleReminder} />
      <H2>{t('me.privacy')}</H2>
      <Button kind="secondary" title={t('me.export')} onPress={exportData} />
      <Button kind="secondary" title={t('common.delete') + ' — ' + t('verify.title')} onPress={delEvidence} />
      <Button kind="danger" title={t('me.delete')} onPress={delAccount} />
      <Button kind="secondary" title={t('auth.logout')} onPress={signOut} />
      {msg ? <Body tone="warn">{msg}</Body> : null}
      <Disclaimer kind="points" />
      <Disclaimer kind="content" />
    </Screen>
  );
}
