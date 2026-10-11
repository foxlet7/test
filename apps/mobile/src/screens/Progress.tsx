import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api } from '../api';
import { Bar, Body, Card, Disclaimer, H1, H2, Row, Screen } from '../components/ui';
import { pick, useLang } from '../i18n';

export default function Progress() {
  const { t, td, lang } = useLang();
  const nav = useNavigation<any>();
  const [d, setD] = useState<any>(null);
  useFocusEffect(useCallback(() => { api('/dashboard').then(setD).catch(() => {}); }, []));
  const max = Math.max(1, ...(d?.categories.map((c: any) => c.eligible) ?? [1]));
  return (
    <Screen>
      <H1>{t('progress.title')}</H1>
      {d && (
        <>
          <Row wrap>
            {(['week', 'month', 'lifetime'] as const).map((k) => (
              <Card key={k}><Body muted small>{td(`progress.${k}`)}</Body><Body>{d.totals[k].eligible} · {t('progress.eligible')}</Body><Body muted small>{d.totals[k].verified} · {t('progress.verified')}</Body></Card>
            ))}
          </Row>
          <Body muted>{t('progress.activeDays')}: {d.activeDays30}</Body>
          <H2>{t('progress.categories')}</H2>
          {d.categories.map((c: any) => <Card key={c.category}><Body>{td(`category.${c.category}`)} — {c.eligible}</Body><Bar value={c.eligible} max={max} /></Card>)}
          <H2>{t('progress.achievements')}</H2>
          <Row>{d.achievements.map((a: any) => <Card key={a.id}><Body tone={a.earned ? 'ok' : undefined} muted={!a.earned}>{a.earned ? '✓ ' : '○ '}{td(`achievement.${a.id}`)}</Body></Card>)}</Row>
          <H2>{t('tabs.today')}</H2>
          {d.recent.slice(0, 10).map((l: any) => (
            <Card key={l.id} onPress={() => (l.status === 'self_reported' || l.status === 'unable_to_verify') ? nav.navigate('Verify', { logId: l.id, activityId: l.activity_id }) : undefined}>
              <Body>{pick(lang, l.title_en, l.title_ar)}</Body><Body muted small>{l.local_date} · {td(`status.${l.status}`)}</Body>
            </Card>
          ))}
        </>
      )}
      <Disclaimer kind="points" />
    </Screen>
  );
}
