import { requireUser } from '@/lib/auth';
import { Wall } from '@/components/Wall';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NOC wall' };

export default async function NocPage() {
  await requireUser();
  return <Wall />;
}
