import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { PERIODS, type Period } from '@gdc/shared';
import { api } from '../api';
import { Body, Button, Card, Chip, Disclaimer, H1, Row, Screen } from '../components/ui';
import { useLang } from '../i18n';
import { useSession } from '../session';

export default function Boards() {
  const { t, td, lang } = useLang();
  const { me, refreshMe } = useSession();
  const [board, setBoard] = useState<'A' | 'B'>('A');
  const [period, setPeriod] = useState<Period>('weekly');
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    if (!me?.profile.tradition) return;
    try { setD(await api(`/leaderboards/${board}?period=${period}`)); setErr(false); } catch { setErr(true); }
  }, [board, period, me?.profile.tradition]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!me?.profile.tradition) return <Screen><H1>{t('boards.title')}</H1><Body muted>{t('boards.needTradition')}</Body></Screen>;

  const join = () => Alert.alert(t('boards.join'), t('boards.consentBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('boards.join'), onPress: async () => { await api(`/leaderboards/${board}/membership`, { json: { consent: true } }); await refreshMe(); await load(); } },
  ]);
  const leave = async () => { await api(`/leaderboards/${board}/membership`, { method: 'DELETE' }); await refreshMe(); await load(); };

  return (
    <Screen>
      <H1>{t('boards.title')}</H1>
      <Row>
        <Chip title={t('boards.boardA')} selected={board === 'A'} onPress={() => setBoard('A')} />
        <Chip title={t('boards.boardB')} selected={board === 'B'} onPress={() => setBoard('B')} />
      </Row>
      <Body muted small>{t(board === 'A' ? 'boards.boardAExplain' : 'boards.boardBExplain')}</Body>
      <Row>{PERIODS.map((p) => <Chip key={p} title={td(`boards.${p}`)} selected={period === p} onPress={() => setPeriod(p)} />)}</Row>
      {err && <Body tone="warn">{t('common.error')}</Body>}
      {d && (
        <>
          {d.cutoff && <Body muted small>{t('boards.cutoff')}: {new Date(d.cutoff).toLocaleString(lang === 'ar' ? 'ar' : 'en')}</Body>}
          {d.isMember ? (
            <Card>{d.me ? <Body>{t('boards.rank')}: #{d.me.rank} · {d.me.points}</Body> : <Body muted>—</Body>}<Button kind="secondary" title={t('boards.leave')} onPress={leave} /></Card>
          ) : (
            <Card><Body muted>{t('boards.notMember')}</Body><Button title={t('boards.join')} onPress={join} /></Card>
          )}
          {d.rows.length === 0 ? <Body muted>{t('boards.empty')}</Body> : d.rows.map((r: any) => (
            <Card key={`${r.rank}-${r.pseudonym}`}><Body>#{r.rank}  {r.pseudonym}  ·  {r.points}</Body></Card>
          ))}
        </>
      )}
      <Disclaimer kind="points" />
      <Disclaimer kind="verification" />
    </Screen>
  );
}
