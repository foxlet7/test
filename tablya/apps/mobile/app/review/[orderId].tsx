import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Button, Field, Row, Screen, toast, Txt } from '../../src/components/ui';
import { track } from '../../src/lib/analytics';
import { api } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';

export default function Review() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const submit = useMutation({
    mutationFn: () =>
      api('/reviews', {
        method: 'POST',
        body: { orderId, rating, ...(text.trim() ? { text: text.trim() } : {}) },
      }),
    onSuccess: async () => {
      track('review_created');
      await qc.invalidateQueries({ queryKey: ['order', orderId] });
      toast(t('review.thanks'));
      router.back();
    },
    onError: (e) => toast(errorMessage(e, locale), 'bad'),
  });
  return (
    <Screen>
      <Row accessibilityRole="radiogroup" gap={4}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityLabel={`${n}`}
            accessibilityState={{ selected: rating === n }}
            onPress={() => setRating(n)}
            style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Txt style={{ fontSize: 34 }}>{n <= rating ? '★' : '☆'}</Txt>
          </Pressable>
        ))}
      </Row>
      <Field
        label={t('review.placeholder')}
        value={text}
        onChangeText={setText}
        multiline
        maxLength={1500}
      />
      <Button
        title={t('review.submit')}
        onPress={() => submit.mutate()}
        loading={submit.isPending}
      />
    </Screen>
  );
}
