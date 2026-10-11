import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useState } from 'react';
import { Pressable, Switch } from 'react-native';
import { z } from 'zod';
import { passwordSchema, phoneSchema } from '@tablya/shared';
import { Button, Field, Row, Screen, Txt } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  password: passwordSchema,
  phone: z.union([z.literal(''), phoneSchema]).optional(),
});
type Form = z.infer<typeof schema>;

export default function Register() {
  const { t, locale } = useT();
  const params = useLocalSearchParams<{ cook?: string }>();
  const register = useAuth((s) => s.register);
  const [cook, setCook] = useState(params.cook === '1');
  const [serverError, setServerError] = useState('');
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', phone: '' },
  });

  const submit = handleSubmit(async (v) => {
    setServerError('');
    try {
      await register({
        email: v.email.toLowerCase(),
        password: v.password,
        name: v.name,
        phone: v.phone || undefined,
        role: cook ? 'COOK' : 'CUSTOMER',
        locale,
      });
    } catch (e) {
      setServerError(errorMessage(e, locale));
    }
  });
  const field = (name: keyof Form, label: string, extra: object = {}, hint?: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur } }) => (
        <Field
          label={label}
          value={value ?? ''}
          onChangeText={onChange}
          onBlur={onBlur}
          error={errors[name]?.message ? t('errors.VALIDATION_FAILED') : undefined}
          hint={hint}
          {...extra}
        />
      )}
    />
  );
  return (
    <Screen>
      <Txt variant="h1" accessibilityRole="header">
        {t('auth.createAccount')}
      </Txt>
      {field('name', t('auth.name'), { autoComplete: 'name' })}
      {field('email', t('auth.email'), {
        autoCapitalize: 'none',
        keyboardType: 'email-address',
        autoComplete: 'email',
      })}
      {field(
        'password',
        t('auth.password'),
        { secureTextEntry: true, autoComplete: 'new-password' },
        t('auth.passwordHint'),
      )}
      {field('phone', t('auth.phone'), { keyboardType: 'phone-pad', autoComplete: 'tel' })}
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: cook }}
        onPress={() => setCook(!cook)}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Row>
          <Switch value={cook} onValueChange={setCook} />
          <Txt>{t('auth.iAmCook')}</Txt>
        </Row>
      </Pressable>
      {serverError ? (
        <Txt color="#B3261E" accessibilityRole="text">
          {serverError}
        </Txt>
      ) : null}
      <Button title={t('auth.register')} onPress={submit} loading={isSubmitting} />
      <Button title={t('auth.have')} variant="ghost" onPress={() => router.replace('/login')} />
    </Screen>
  );
}
