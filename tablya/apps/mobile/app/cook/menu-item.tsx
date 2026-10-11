import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image } from 'expo-image';
import { Button, Field, Row, Screen, toast, Txt } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useCookKitchen } from '../../src/lib/cook';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';
import { pickAndUpload } from '../../src/lib/upload';

export default function NewDish() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const { kitchen } = useCookKitchen();
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [photo, setPhoto] = useState<{ key: string; url: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const priceMinor = Math.round(parseFloat(price.replace(',', '.')) * 100);
  const valid = name.trim().length > 0 && Number.isFinite(priceMinor) && priceMinor >= 0;

  const save = useMutation({
    mutationFn: () =>
      api(`/cook/kitchens/${kitchen!.id}/menu`, {
        method: 'POST',
        body: {
          name: name.trim(),
          ...(nameAr.trim() ? { nameAr: nameAr.trim() } : {}),
          priceMinor,
          imageKeys: photo ? [photo.key] : [],
          ...(stock ? { stock: parseInt(stock, 10) } : {}),
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['cook-menu'] });
      router.back();
    },
    onError: (e) => toast(errorMessage(e, locale), 'bad'),
  });
  const addPhoto = async () => {
    setUploading(true);
    try {
      const r = await pickAndUpload('menu_item');
      if (r) setPhoto(r);
    } catch (e) {
      toast(
        (e as { permissionDenied?: boolean }).permissionDenied
          ? t('errors.UPLOAD_REJECTED')
          : errorMessage(e, locale),
        'bad',
      );
    } finally {
      setUploading(false);
    }
  };
  return (
    <Screen>
      <Field label={t('cook.menu.name')} value={name} onChangeText={setName} maxLength={100} />
      <Field
        label={`${t('cook.menu.name')} (العربية)`}
        value={nameAr}
        onChangeText={setNameAr}
        maxLength={100}
      />
      <Field
        label={t('cook.menu.price')}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
      />
      <Field
        label={t('cook.menu.stock')}
        value={stock}
        onChangeText={(v) => setStock(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
      />
      <Row>
        <Button
          title={t('cook.menu.photo')}
          variant="secondary"
          onPress={addPhoto}
          loading={uploading}
        />
        {photo?.url ? (
          <Image
            source={{ uri: photo.url }}
            style={{ width: 64, height: 64, borderRadius: 8 }}
            accessibilityLabel={name}
          />
        ) : (
          <Txt muted>{t('common.optional')}</Txt>
        )}
      </Row>
      <Button
        title={t('common.add')}
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!valid || !kitchen}
      />
    </Screen>
  );
}
