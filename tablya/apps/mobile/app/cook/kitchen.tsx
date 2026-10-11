import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Switch } from 'react-native';
import {
  Button,
  Card,
  ErrorState,
  Pill,
  Row,
  Screen,
  SkeletonList,
  toast,
  Txt,
} from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useCookKitchen } from '../../src/lib/cook';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';

export default function CookKitchen() {
  const { t, locale, pick } = useT();
  const qc = useQueryClient();
  const { kitchen, isLoading, error, refetch } = useCookKitchen();
  const set = useMutation({
    mutationFn: (body: object) =>
      api(`/cook/kitchens/${kitchen!.id}/availability`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cook-kitchens'] }),
    onError: (e) => toast(errorMessage(e, locale), 'bad'),
  });
  if (isLoading)
    return (
      <Screen>
        <SkeletonList rows={1} />
      </Screen>
    );
  if (error || !kitchen)
    return (
      <Screen>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  const paused = kitchen.pausedUntil && new Date(kitchen.pausedUntil) > new Date();
  return (
    <Screen>
      <Card>
        <Txt variant="h2">{pick(kitchen.name, kitchen.nameAr)}</Txt>
        <Row>
          <Txt muted>{t('cook.kitchen.status')}:</Txt>
          <Pill
            text={t(`status.${kitchen.verification}`)}
            tone={
              kitchen.verification === 'VERIFIED'
                ? 'ok'
                : kitchen.verification === 'REJECTED' || kitchen.verification === 'SUSPENDED'
                  ? 'bad'
                  : 'warn'
            }
          />
        </Row>
        {kitchen.verificationNote ? (
          <Txt variant="small" muted>
            {kitchen.verificationNote}
          </Txt>
        ) : null}
      </Card>
      {['DRAFT', 'REJECTED'].includes(kitchen.verification) && (
        <Button title={t('cook.onboard.title')} onPress={() => router.push('/cook/onboarding')} />
      )}
      {kitchen.verification === 'VERIFIED' && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt>{t('cook.kitchen.accepting')}</Txt>
            <Switch
              accessibilityLabel={t('cook.kitchen.accepting')}
              value={kitchen.acceptingOrders && !paused}
              onValueChange={(v) => set.mutate({ acceptingOrders: v, pausedUntil: null })}
            />
          </Row>
          <Button
            title={t('cook.kitchen.pause1h')}
            variant="secondary"
            onPress={() =>
              set.mutate({ pausedUntil: new Date(Date.now() + 3_600_000).toISOString() })
            }
          />
        </Card>
      )}
      <Button title={t('tab.home')} variant="ghost" onPress={() => router.replace('/')} />
    </Screen>
  );
}
