import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Cover } from '../../src/components/domain';
import {
  AsyncView,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Pill,
  Row,
  Screen,
  toast,
  Txt,
} from '../../src/components/ui';
import { track } from '../../src/lib/analytics';
import { api, ApiError } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';
import { radius, space, useColors } from '../../src/lib/theme';
import type { Dish, OptionGroup } from '../../src/lib/types';

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale, money, pick } = useT();
  const c = useColors();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['item', id],
    queryFn: () => api<Dish>(`/menu-items/${id}`, { auth: false }),
  });
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mixed, setMixed] = useState(false);
  useEffect(() => {
    track('food_viewed');
  }, []);

  const d = q.data;
  // Preselect the first option of required single-choice groups (typical "Size" picker).
  useEffect(() => {
    if (!d) return;
    setChosen((cur) => {
      const next = { ...cur };
      for (const g of d.optionGroups)
        if (g.required && g.maxSelect === 1 && !next[g.id]?.length) {
          const first = g.options.find((o) => o.isAvailable);
          if (first) next[g.id] = [first.id];
        }
      return next;
    });
  }, [d]);

  const selectedIds = useMemo(() => Object.values(chosen).flat(), [chosen]);
  const unit = useMemo(() => {
    if (!d) return 0;
    const extra = d.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => selectedIds.includes(o.id))
      .reduce((s, o) => s + o.priceDeltaMinor, 0);
    return d.priceMinor + extra;
  }, [d, selectedIds]);
  const groupError = (g: OptionGroup) => {
    const n = chosen[g.id]?.length ?? 0;
    return n < Math.max(g.required ? 1 : 0, g.minSelect) || n > g.maxSelect;
  };
  const invalid = !!d && d.optionGroups.some(groupError);

  const toggle = (g: OptionGroup, oid: string) =>
    setChosen((cur) => {
      const has = cur[g.id] ?? [];
      if (g.maxSelect === 1)
        return { ...cur, [g.id]: has.includes(oid) && !g.required ? [] : [oid] };
      return {
        ...cur,
        [g.id]: has.includes(oid)
          ? has.filter((x) => x !== oid)
          : has.length < g.maxSelect
            ? [...has, oid]
            : has,
      };
    });

  const add = async (replace = false) => {
    if (!d) return;
    setBusy(true);
    try {
      await api(`/cart/items${replace ? '?replace=true' : ''}`, {
        method: 'POST',
        body: {
          menuItemId: d.id,
          quantity: qty,
          optionIds: selectedIds,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      track('add_to_cart');
      await qc.invalidateQueries({ queryKey: ['cart'] });
      toast(t('common.done'));
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.body.code === 'CART_MIXED_KITCHENS') setMixed(true);
      else toast(errorMessage(e, locale), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        d ? (
          <View style={{ padding: space.lg, gap: space.md }}>
            <Row style={{ justifyContent: 'center' }} gap={space.xl}>
              <Button
                title="−"
                variant="secondary"
                onPress={() => setQty(Math.max(1, qty - 1))}
                accessibilityHint={t('common.remove')}
                style={{ width: 56 }}
              />
              <Txt variant="h2" accessibilityLabel={String(qty)}>
                {qty}
              </Txt>
              <Button
                title="+"
                variant="secondary"
                onPress={() => setQty(Math.min(50, qty + 1))}
                accessibilityHint={t('common.add')}
                style={{ width: 56 }}
              />
            </Row>
            <Button
              title={t('item.addFor', { price: money(unit * qty) })}
              onPress={() => void add()}
              loading={busy}
              disabled={!d.isAvailable || invalid}
            />
          </View>
        ) : undefined
      }
    >
      <AsyncView query={q}>
        {(d) => (
          <View style={{ gap: space.lg }}>
            <Cover url={d.imageUrls[0] ?? null} height={200} label={pick(d.name, d.nameAr)} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="h1" style={{ flex: 1 }} accessibilityRole="header">
                {pick(d.name, d.nameAr)}
              </Txt>
              {!d.isAvailable && <Pill text={t('item.unavailable')} tone="bad" />}
            </Row>
            <Txt variant="h3">{money(d.priceMinor)}</Txt>
            <Txt muted>{pick(d.description, d.descriptionAr)}</Txt>
            {d.ingredients.length > 0 && (
              <Txt variant="small" muted>
                {t('item.ingredients')}: {d.ingredients.join(', ')}
              </Txt>
            )}
            {d.allergens.length > 0 && (
              <Txt variant="small" color={c.warn}>
                ⚠ {t('item.allergens')}: {d.allergens.join(', ')}
              </Txt>
            )}
            {d.optionGroups.map((g) => (
              <Card key={g.id} style={groupError(g) ? { borderColor: c.danger } : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt variant="h3">{pick(g.name, g.nameAr)}</Txt>
                  {g.required ? (
                    <Pill text={t('item.required')} tone="warn" />
                  ) : g.maxSelect > 1 ? (
                    <Txt variant="small" muted>
                      {t('item.chooseUpTo', { n: g.maxSelect })}
                    </Txt>
                  ) : null}
                </Row>
                {g.options.map((o) => {
                  const on = chosen[g.id]?.includes(o.id);
                  return (
                    <Pressable
                      key={o.id}
                      disabled={!o.isAvailable}
                      accessibilityRole={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                      accessibilityState={{ checked: !!on, disabled: !o.isAvailable }}
                      onPress={() => toggle(g, o.id)}
                      style={{
                        minHeight: 48,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        opacity: o.isAvailable ? 1 : 0.4,
                      }}
                    >
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: g.maxSelect === 1 ? 11 : radius.sm,
                          borderWidth: 2,
                          borderColor: on ? c.brand : c.border,
                          backgroundColor: on ? c.brand : 'transparent',
                        }}
                      />
                      <Txt style={{ flex: 1 }}>{pick(o.name, o.nameAr)}</Txt>
                      {o.priceDeltaMinor !== 0 && (
                        <Txt muted>
                          {o.priceDeltaMinor > 0 ? '+' : ''}
                          {money(o.priceDeltaMinor)}
                        </Txt>
                      )}
                    </Pressable>
                  );
                })}
              </Card>
            ))}
            <Field
              label={t('item.notes')}
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={300}
            />
          </View>
        )}
      </AsyncView>
      <ConfirmDialog
        visible={mixed}
        title={t('cart.mixed.title')}
        body={t('cart.mixed.body')}
        confirmLabel={t('cart.clear')}
        danger
        onCancel={() => setMixed(false)}
        onConfirm={async () => {
          setMixed(false);
          await add(true);
        }}
      />
    </Screen>
  );
}
