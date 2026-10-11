import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Field, Row, Screen, toast, Txt } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useCookKitchen } from '../../src/lib/cook';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';
import { requestLocation } from '../../src/lib/location';
import { pickAndUpload } from '../../src/lib/upload';

const DEFAULT_SLOTS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  openMinute: 9 * 60,
  closeMinute: 22 * 60,
}));

/** Three steps: kitchen basics → first dish → private verification document → submit for admin review. */
export default function Onboarding() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const { kitchen } = useCookKitchen();
  const [form, setForm] = useState({ name: '', description: '', city: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [docUploaded, setDocUploaded] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['cook-kitchens'] });
  const fail = (e: unknown) => toast(errorMessage(e, locale), 'bad');

  const create = async () => {
    setBusy('create');
    try {
      const pos = await requestLocation();
      if (!pos) return toast(t('addr.needLocation'), 'bad');
      const k = await api<{ id: string }>('/cook/kitchens', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          city: form.city.trim(),
          lat: pos.lat,
          lng: pos.lng,
        },
      });
      await api(`/cook/kitchens/${k.id}/schedule`, {
        method: 'PUT',
        body: { slots: DEFAULT_SLOTS },
      });
      await api(`/cook/kitchens/${k.id}/zones`, {
        method: 'PUT',
        body: {
          zones: [
            { name: 'Nearby', maxKm: 5, feeMinor: 1000, etaMinutes: 25 },
            { name: 'City', maxKm: 15, feeMinor: 2000, etaMinutes: 45 },
          ],
        },
      });
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const cover = async () => {
    setBusy('cover');
    try {
      const r = await pickAndUpload('kitchen');
      if (r) {
        await api(`/cook/kitchens/${kitchen!.id}`, { method: 'PATCH', body: { coverKey: r.key } });
        await refresh();
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const doc = async () => {
    setBusy('doc');
    try {
      const r = await pickAndUpload('verification_doc');
      if (r) {
        await api(`/cook/kitchens/${kitchen!.id}/documents`, {
          method: 'POST',
          body: { type: 'NATIONAL_ID', key: r.key },
        });
        setDocUploaded(true);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const submit = useMutation({
    mutationFn: () => api(`/cook/kitchens/${kitchen!.id}/submit`, { method: 'POST' }),
    onSuccess: async () => {
      await refresh();
      router.replace('/cook/kitchen');
    },
    onError: fail,
  });

  if (kitchen && !['DRAFT', 'REJECTED'].includes(kitchen.verification))
    return (
      <Screen>
        <Card>
          <Txt>{t('cook.onboard.pending')}</Txt>
        </Card>
        <Button title={t('cook.tab.kitchen')} onPress={() => router.replace('/cook/kitchen')} />
      </Screen>
    );

  if (!kitchen) {
    return (
      <Screen>
        <Txt variant="h1" accessibilityRole="header">
          {t('cook.onboard.title')}
        </Txt>
        <Field
          label={t('cook.onboard.name')}
          value={form.name}
          onChangeText={(v) => setForm({ ...form, name: v })}
          maxLength={80}
        />
        <Field
          label={t('cook.onboard.desc')}
          value={form.description}
          onChangeText={(v) => setForm({ ...form, description: v })}
          multiline
          maxLength={1000}
        />
        <Field
          label={t('cook.onboard.city')}
          value={form.city}
          onChangeText={(v) => setForm({ ...form, city: v })}
          maxLength={80}
        />
        <Txt variant="small" muted>
          {t('welcome.locationWhy')}
        </Txt>
        <Txt variant="small" muted>
          {t('cook.onboard.hours')}
        </Txt>
        <Button
          title={t('common.next')}
          onPress={create}
          loading={busy === 'create'}
          disabled={form.name.trim().length < 2 || !form.city.trim()}
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <Txt variant="h1" accessibilityRole="header">
        {kitchen.name}
      </Txt>
      {kitchen.verificationNote ? (
        <Card>
          <Txt color="#B3261E">{kitchen.verificationNote}</Txt>
        </Card>
      ) : null}
      <Row>
        <Txt style={{ flex: 1 }}>1. {t('cook.menu.photo')}</Txt>
        <Button
          title={kitchen.coverUrl ? '✓' : t('common.add')}
          variant="secondary"
          onPress={cover}
          loading={busy === 'cover'}
        />
      </Row>
      <Row>
        <Txt style={{ flex: 1 }}>2. {t('cook.menu.add')}</Txt>
        <Button
          title={t('common.add')}
          variant="secondary"
          onPress={() => router.push('/cook/menu-item')}
        />
      </Row>
      <Txt variant="small" muted>
        3. {t('cook.onboard.docs')}
      </Txt>
      <Button
        title={docUploaded ? '✓' : t('common.add')}
        variant="secondary"
        onPress={doc}
        loading={busy === 'doc'}
      />
      <Button
        title={t('cook.onboard.submit')}
        onPress={() => submit.mutate()}
        loading={submit.isPending}
      />
    </Screen>
  );
}
