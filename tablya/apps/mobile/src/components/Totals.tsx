import { useT } from '../lib/i18n';
import type { CartView } from '../lib/types';
import { Card, Row, Txt } from './ui';

export function Totals({ p }: { p: NonNullable<CartView['pricing']> }) {
  const { t, money } = useT();
  const line = (label: string, v: number, strong = false) => (
    <Row style={{ justifyContent: 'space-between' }}>
      <Txt variant={strong ? 'h3' : 'body'} muted={!strong}>
        {label}
      </Txt>
      <Txt variant={strong ? 'h3' : 'body'}>{money(v)}</Txt>
    </Row>
  );
  return (
    <Card>
      {line(t('cart.subtotal'), p.subtotal)}
      {p.discount > 0 && line(t('cart.discount'), -p.discount)}
      {p.deliveryFee > 0 && line(t('cart.delivery'), p.deliveryFee)}
      {p.serviceFee > 0 && line(t('cart.service'), p.serviceFee)}
      {line(t('cart.tax'), p.tax)}
      {line(t('cart.total'), p.total, true)}
    </Card>
  );
}
