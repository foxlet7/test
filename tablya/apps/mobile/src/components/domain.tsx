import { Image } from 'expo-image';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '../lib/i18n';
import { radius, space, useColors } from '../lib/theme';
import { Card, Pill, Row, Txt } from './ui';

export interface KitchenCardData {
  id: string;
  name: string;
  nameAr: string | null;
  coverUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  prepTimeMin: number;
  minOrderMinor: number;
  deliveryFeeFromMinor: number | null;
  distanceKm: number | null;
  availability: 'OPEN' | 'CLOSED' | 'TEMPORARILY_UNAVAILABLE' | 'FULLY_BOOKED';
  cuisines: { id: string; name: string; nameAr: string }[];
}

export function availabilityTone(a: KitchenCardData['availability']) {
  return a === 'OPEN' ? 'ok' : a === 'FULLY_BOOKED' ? 'warn' : 'bad';
}

export function Cover({
  url,
  height = 130,
  label,
}: {
  url: string | null;
  height?: number;
  label?: string;
}) {
  const c = useColors();
  return url ? (
    <Image
      source={{ uri: url }}
      accessibilityLabel={label}
      style={{ height, width: '100%', borderRadius: radius.md }}
      contentFit="cover"
      transition={150}
    />
  ) : (
    <View
      style={{
        height,
        width: '100%',
        borderRadius: radius.md,
        backgroundColor: c.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityElementsHidden
    >
      <Txt style={{ fontSize: 36 }}>🍲</Txt>
    </View>
  );
}

export function KitchenCard({ k }: { k: KitchenCardData }) {
  const { t, money, pick } = useT();
  const name = pick(k.name, k.nameAr);
  return (
    <Card onPress={() => router.push(`/kitchen/${k.id}`)} label={name}>
      <Cover url={k.coverUrl} label={name} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h3" numberOfLines={1} style={{ flex: 1 }}>
          {name}
        </Txt>
        <Pill
          text={t(`kitchen.${k.availability.toLowerCase()}`)}
          tone={availabilityTone(k.availability)}
        />
      </Row>
      <Txt variant="small" muted numberOfLines={1}>
        {k.cuisines.map((c) => pick(c.name, c.nameAr)).join(' · ')}
      </Txt>
      <Row gap={space.md}>
        <Txt variant="small">
          ★ {k.ratingCount ? k.ratingAvg.toFixed(1) : '—'} ({k.ratingCount})
        </Txt>
        <Txt variant="small" muted>
          {t('kitchen.min.prep', { n: k.prepTimeMin })}
        </Txt>
        {k.distanceKm != null && (
          <Txt variant="small" muted>
            {k.distanceKm} km
          </Txt>
        )}
        {k.deliveryFeeFromMinor != null && (
          <Txt variant="small" muted>
            {money(k.deliveryFeeFromMinor)}
          </Txt>
        )}
      </Row>
    </Card>
  );
}

export interface DishData {
  id: string;
  name: string;
  nameAr: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  priceMinor: number;
  imageUrls: (string | null)[];
  isAvailable: boolean;
  kitchen?: { id: string; name: string; nameAr: string | null };
}

export function DishRow({ d, onPress }: { d: DishData; onPress: () => void }) {
  const { t, money, pick } = useT();
  const name = pick(d.name, d.nameAr);
  return (
    <Card
      onPress={onPress}
      label={name}
      style={{ flexDirection: 'row', gap: space.md, opacity: d.isAvailable ? 1 : 0.55 }}
    >
      <View style={{ flex: 1, gap: space.xs }}>
        <Txt variant="h3" numberOfLines={2}>
          {name}
        </Txt>
        {d.kitchen && (
          <Txt variant="small" muted numberOfLines={1}>
            {pick(d.kitchen.name, d.kitchen.nameAr)}
          </Txt>
        )}
        <Txt variant="small" muted numberOfLines={2}>
          {pick(d.description, d.descriptionAr)}
        </Txt>
        <Row>
          <Txt variant="label">{money(d.priceMinor)}</Txt>
          {!d.isAvailable && <Pill text={t('item.unavailable')} tone="bad" />}
        </Row>
      </View>
      <View style={{ width: 92 }}>
        <Cover url={d.imageUrls[0] ?? null} height={92} />
      </View>
    </Card>
  );
}

export const statusTone = (s: string) =>
  (['COMPLETED', 'DELIVERED', 'REFUNDED'].includes(s)
    ? 'ok'
    : ['CANCELLED', 'REJECTED'].includes(s)
      ? 'bad'
      : 'warn') as 'ok' | 'bad' | 'warn';
