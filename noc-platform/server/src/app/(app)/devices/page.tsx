import Link from 'next/link';
import { requireUser, can } from '@/lib/auth';
import { db } from '@/lib/db';
import { worst, type Status } from '@/lib/status';
import { ActionForm } from '@/components/ActionForm';
import { DeviceFields } from '@/components/DeviceFields';
import { createDevice, createSite, deleteSite } from '@/app/actions';

export default async function Devices() {
  const u = await requireUser();
  const [sites, probes, devices] = await Promise.all([
    db.site.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db.probe.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.device.findMany({
      where: { tenantId: u.tenantId }, orderBy: { name: 'asc' },
      include: { sensors: { select: { status: true, paused: true } }, probe: { select: { name: true } } },
    }),
  ]);
  const groups = [...sites.map((s) => ({ id: s.id as string | null, name: s.name })), { id: null, name: 'No site' }]
    .map((g) => ({ ...g, devices: devices.filter((d) => d.siteId === g.id) }))
    .filter((g) => g.id !== null || g.devices.length);
  const edit = can(u, 'OPERATOR');

  return (
    <>
      <div className="page-head">
        <div><h1>Devices</h1><div className="sub">{devices.length} devices · {devices.reduce((n, d) => n + d.sensors.length, 0)} sensors</div></div>
      </div>

      {!probes.length && (
        <div className="notice" style={{ marginBottom: '1rem' }}>
          No probe yet. Devices are polled by a probe running near them. <Link href="/probes">Create a probe</Link> first, then add devices.
        </div>
      )}

      <div className="grid split">
        <div>
          {groups.length === 0 && <div className="card"><div className="empty"><b>No devices yet</b>Add a site and your first device on the right.</div></div>}
          {groups.map((g) => (
            <section className="card" key={g.id ?? 'none'}>
              <div className="card-head">
                <h2>{g.name}</h2>
                <span className="muted" style={{ color: '#e4e1f7' }}>{g.devices.length} devices</span>
              </div>
              {g.devices.length === 0 ? (
                <div className="empty">No devices on this site.{edit && g.id && <form action={deleteSite} className="inline"><input type="hidden" name="id" value={g.id} /> <button className="btn danger small">Delete site</button></form>}</div>
              ) : (
                <table>
                  <thead><tr><th>Device</th><th>Host</th><th className="hide-sm">Probe</th><th className="r">Sensors</th></tr></thead>
                  <tbody>
                    {g.devices.map((d) => {
                      const st = d.paused ? 'PAUSED' : worst(d.sensors.map((s) => (s.paused ? 'PAUSED' : s.status) as Status));
                      const bad = d.sensors.filter((s) => !s.paused && (s.status === 'DOWN' || s.status === 'WARNING')).length;
                      return (
                        <tr key={d.id} className={'s-' + (d.sensors.length ? st : 'UNKNOWN')}>
                          <td><span className="dot" /> <Link href={`/devices/${d.id}`}><b>{d.name}</b></Link> <span className="muted">{d.kind !== 'generic' ? d.kind : ''}</span></td>
                          <td className="num">{d.host}</td>
                          <td className="hide-sm muted">{d.probe?.name ?? <span style={{ color: '#ff8a8f' }}>not assigned</span>}</td>
                          <td className="r">{bad ? <span className={'badge s-' + st}>{bad} need attention</span> : <span className="muted">{d.sensors.length}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>

        {edit && (
          <div>
            <section className="card">
              <div className="card-head"><h2>Add device</h2></div>
              <div className="card-body">
                <ActionForm action={createDevice} submit="Add device">
                  <DeviceFields sites={sites} probes={probes} />
                </ActionForm>
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Add site</h2></div>
              <div className="card-body">
                <ActionForm action={createSite} submit="Add site">
                  <div className="row2">
                    <label>Name<input name="name" required maxLength={80} placeholder="Laban" /></label>
                    <label>Location<input name="location" maxLength={120} placeholder="Riyadh" /></label>
                  </div>
                </ActionForm>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
