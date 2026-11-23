import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, can } from '@/lib/auth';
import { db } from '@/lib/db';
import { since } from '@/lib/format';
import { unitOf } from '@/lib/ingest';
import { ActionForm } from '@/components/ActionForm';
import { DeviceFields } from '@/components/DeviceFields';
import { SensorForm } from '@/components/SensorForm';
import { HistoryChart } from '@/components/HistoryChart';
import { deleteDevice, deleteSensor, toggleDevicePause, toggleSensorPause, updateDevice } from '@/app/actions';

const TYPE_LABEL: Record<string, string> = { PING: 'Ping', SNMP_TRAFFIC: 'SNMP traffic', SNMP_OID: 'SNMP OID', SNMP_UPTIME: 'SNMP uptime', HTTP: 'HTTP', TCP: 'TCP', DNS: 'DNS' };

export default async function DevicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ s?: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const { s: pick } = await searchParams;
  const d = await db.device.findFirst({
    where: { id, tenantId: u.tenantId },
    include: { sensors: { orderBy: { name: 'asc' } }, site: true, probe: true },
  });
  if (!d) notFound();
  const [sites, probes] = await Promise.all([
    db.site.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.probe.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const edit = can(u, 'OPERATOR');
  const selected = d.sensors.find((s) => s.id === pick) || d.sensors[0];
  const v3 = (d.snmpV3 || null) as { user?: string; authProto?: string; privProto?: string } | null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub"><Link href="/devices">Devices</Link> › {d.site?.name ?? 'No site'}</div>
          <h1>{d.name} {d.paused && <span className="badge s-PAUSED">paused</span>}</h1>
          <div className="sub num">{d.host} · {d.kind} · probe: {d.probe?.name ?? 'none'} · SNMP: {d.snmpVersion ? 'v' + d.snmpVersion : 'off'}</div>
        </div>
        {edit && (
          <div className="actions">
            <form action={toggleDevicePause}><input type="hidden" name="id" value={d.id} /><button className="btn ghost">{d.paused ? 'Resume' : 'Pause'}</button></form>
            <form action={deleteDevice}><input type="hidden" name="id" value={d.id} /><button className="btn danger">Delete device</button></form>
          </div>
        )}
      </div>

      <div className="grid split">
        <div>
          <section className="card">
            <div className="card-head"><h2>Sensors</h2><span style={{ color: '#e4e1f7' }}>{d.sensors.length}</span></div>
            {d.sensors.length === 0 ? <div className="empty"><b>No sensors</b>Add one on the right: Ping first, then SNMP traffic for links.</div> : (
              <table>
                <thead><tr><th>Sensor</th><th className="r">Last value</th><th className="hide-sm">Message</th><th className="r">Checked</th>{edit && <th />}</tr></thead>
                <tbody>
                  {d.sensors.map((s) => {
                    const st = s.paused || d.paused ? 'PAUSED' : s.status;
                    return (
                      <tr key={s.id} className={'s-' + st} style={s.id === selected?.id ? { background: 'rgba(92,203,226,.07)' } : undefined}>
                        <td><span className="dot" /> <Link href={`?s=${s.id}`}><b>{s.name}</b></Link> <span className="muted">{TYPE_LABEL[s.type]} · {s.intervalSec}s</span>
                          {st !== 'UP' && <> <span className={'badge s-' + st}>{st.toLowerCase()}{s.statusSince ? ' ' + since(s.statusSince) : ''}</span></>}
                        </td>
                        <td className="r"><b>{s.lastText ?? '-'}</b></td>
                        <td className="hide-sm muted">{s.lastMessage ?? ''}</td>
                        <td className="r muted">{s.lastCheckAt ? since(s.lastCheckAt) + ' ago' : 'never'}</td>
                        {edit && (
                          <td className="r"><div className="actions">
                            <form action={toggleSensorPause}><input type="hidden" name="id" value={s.id} /><button className="btn ghost small">{s.paused ? 'Resume' : 'Pause'}</button></form>
                            <form action={deleteSensor}><input type="hidden" name="id" value={s.id} /><button className="btn danger small" aria-label={'Delete ' + s.name}>Delete</button></form>
                          </div></td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
          {selected && (
            <section className="card">
              <div className="card-head"><h2>{selected.name} · history</h2></div>
              <div className="card-body"><HistoryChart sensorId={selected.id} unit={unitOf(selected)} /></div>
            </section>
          )}
        </div>

        {edit && (
          <div>
            <section className="card">
              <div className="card-head"><h2>Add sensor</h2></div>
              <div className="card-body"><SensorForm deviceId={d.id} host={d.host} hasSnmp={!!d.snmpVersion} /></div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Edit device</h2></div>
              <div className="card-body">
                <ActionForm action={updateDevice} resetOnOk={false}>
                  <DeviceFields sites={sites} probes={probes} isNew={false}
                    v={{ id: d.id, name: d.name, host: d.host, kind: d.kind, siteId: d.siteId, probeId: d.probeId, snmpVersion: d.snmpVersion, snmpCommunity: d.snmpCommunity, v3 }} />
                </ActionForm>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
