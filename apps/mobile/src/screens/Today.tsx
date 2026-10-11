import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api } from '../api';
import { Bar, Body, Button, Card, Disclaimer, H1, Screen } from '../components/ui';
import { pick, useLang } from '../i18n';
import { useSession } from '../session';

export default function Today() {
  const { t, td, lang } = useLang();
  const { me } = useSession();
  const nav = useNavigation<any>();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => { try { setD(await api('/dashboard')); setErr(false); } catch { setErr(true); } }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { void load(); }, [load]);
  const todayLogs = d?.recent.filter((l: any) => l.local_date === d.today) ?? [];
  return (
    <Screen>
      <H1>{t('today.title')}</H1>
      <Body muted>{me?.profile.pseudonym}</Body>
      {err && <Body tone="warn" onPress={load}>{t('common.error')}</Body>}
      {d && (
        <>
          <Card>
            <Body>{t('today.goal')}</Body>
            <Bar value={d.weeklyGoal.logged} max={d.weeklyGoal.target} />
            <Body muted small>{d.weeklyGoal.logged} / {d.weeklyGoal.target} {t('today.loggedThisWeek')}</Body>
          </Card>
          <Button title={t('tabs.log')} onPress={() => nav.navigate('Log')} />
          {todayLogs.length === 0 ? <Body muted>{t('today.empty')}</Body> : todayLogs.map((l: any) => (
            <Card key={l.id}><Body>{pick(lang, l.title_en, l.title_ar)}</Body><Body muted small>{td(`status.${l.status}`)}</Body></Card>
          ))}
        </>
      )}
      {!d && !err && <Body muted>{t('common.loading')}</Body>}
      <Disclaimer kind="points" />
    </Screen>
  );
}
