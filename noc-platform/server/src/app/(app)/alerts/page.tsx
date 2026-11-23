import Link from 'next/link';
import { requireUser, can } from '@/lib/auth';
import { db } from '@/lib/db';
import { since } from '@/lib/format';
import { ackAlert } from '@/app/actions';

export default async function Alerts() {
  const u = await requireUser();
  const events = await db.alertEvent.findMany({
    where: { tenantId: u.tenantId }, orderBy: { at: 'desc' }, take: 200,
    include: { sensor: { include: { device: { include: { site: true } } } } },
  });
  return (
    <>
      <div className="page-head"><div><h1>Alerts</h1><div className="sub">Status changes, newest first (last 200)</div></div></div>
      <section className="card">
        {events.length === 0 ? <div className="empty"><b>No alerts yet</b>Status changes of your sensors will appear here.</div> : (
          <table>
            <thead><tr><th>When</th><th>Change</th><th>Device › sensor</th><th className="hide-sm">Message</th><th className="r">Acknowledged</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="num">{e.at.toISOString().replace('T', ' ').slice(0, 16)} <div className="muted">{since(e.at)} ago</div></td>
                  <td><span className={'badge s-' + e.from}>{e.from.toLowerCase()}</span> → <span className={'badge s-' + e.to}>{e.to.toLowerCase()}</span></td>
                  <td><Link href={`/devices/${e.sensor.deviceId}?s=${e.sensorId}`}>{e.sensor.device.name} › {e.sensor.name}</Link><div className="muted">{e.sensor.device.site?.name}</div></td>
                  <td className="hide-sm muted">{e.message}</td>
                  <td className="r">{e.ackedAt ? <span className="muted">{e.ackedBy} · {since(e.ackedAt)} ago</span>
                    : (e.to === 'DOWN' || e.to === 'WARNING') && can(u, 'OPERATOR')
                      ? <form action={ackAlert}><input type="hidden" name="id" value={e.id} /><button className="btn ghost small">Acknowledge</button></form> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
