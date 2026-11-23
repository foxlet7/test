import { headers } from 'next/headers';
import { requireUser, can } from '@/lib/auth';
import { db } from '@/lib/db';
import { since } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import { createProbe, deleteProbe, rotateProbeToken } from '@/app/actions';

export default async function Probes() {
  const u = await requireUser();
  const probes = await db.probe.findMany({
    where: { tenantId: u.tenantId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { devices: true } } },
  });
  const h = await headers();
  const origin = process.env.PUBLIC_URL || `${h.get('x-forwarded-proto') || 'http'}://${h.get('host')}`;
  const admin = can(u, 'ADMIN');

  const docker = [
    'docker run -d --name noc-probe --restart unless-stopped \\',
    `  -e NOC_SERVER=${origin} -e NOC_TOKEN=TOKEN \\`,
    '  --cap-add NET_RAW noc-probe:0.1.0',
  ].join('\n');
  const linux = [
    'sudo install -m 755 noc-probe /usr/local/bin/noc-probe',
    `printf 'NOC_SERVER=${origin}\\nNOC_TOKEN=TOKEN\\n' | sudo tee /etc/noc-probe.env >/dev/null`,
    'sudo chmod 600 /etc/noc-probe.env',
    'sudo install -m 644 noc-probe.service /etc/systemd/system/',
    'sudo systemctl daemon-reload && sudo systemctl enable --now noc-probe',
  ].join('\n');
  const windows = [
    'New-Item -ItemType Directory C:\\NocProbe -Force | Out-Null',
    'Copy-Item .\\noc-probe.exe C:\\NocProbe\\',
    `Set-Content C:\\NocProbe\\noc-probe.env "NOC_SERVER=${origin}\`nNOC_TOKEN=TOKEN"`,
    'icacls C:\\NocProbe\\noc-probe.env /inheritance:r /grant:r SYSTEM:R Administrators:F',
    'sc.exe create NocProbe binPath= "C:\\NocProbe\\noc-probe.exe" start= auto DisplayName= "NOC Platform probe"',
    'sc.exe start NocProbe',
  ].join('\n');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Probes</h1>
          <div className="sub">A probe polls the devices near it and reports here over HTTPS. It only connects out: no inbound firewall rule needed.</div>
        </div>
      </div>
      <div className="grid split">
        <section className="card">
          <div className="card-head"><h2>Your probes</h2></div>
          {probes.length === 0 ? (
            <div className="empty"><b>No probes yet</b>Create one, install it on a server at the site, then add devices.</div>
          ) : (
            <table>
              <thead><tr><th>Probe</th><th>Status</th><th className="r">Devices</th><th className="hide-sm">Host / version</th>{admin && <th />}</tr></thead>
              <tbody>
                {probes.map((p) => {
                  const fresh = p.lastSeenAt && Date.now() - p.lastSeenAt.getTime() < 3 * 60e3;
                  const st = !p.lastSeenAt ? 'UNKNOWN' : fresh ? 'UP' : 'DOWN';
                  return (
                    <tr key={p.id} className={'s-' + st}>
                      <td><span className="dot" /> <b>{p.name}</b></td>
                      <td>{!p.lastSeenAt ? <span className="muted">never connected</span> : fresh ? 'connected' : <span className="badge s-DOWN">offline {since(p.lastSeenAt)}</span>}</td>
                      <td className="r">{p._count.devices}</td>
                      <td className="hide-sm muted">{p.hostname ?? '-'} {p.version ? '· v' + p.version : ''}</td>
                      {admin && (
                        <td className="r">
                          <div className="actions">
                            <ActionForm action={rotateProbeToken} submit="New token" resetOnOk={false} className="inline">
                              <input type="hidden" name="id" value={p.id} />
                            </ActionForm>
                            <form action={deleteProbe}><input type="hidden" name="id" value={p.id} /><button className="btn danger small">Delete</button></form>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        {admin && (
          <section className="card">
            <div className="card-head"><h2>Create probe</h2></div>
            <div className="card-body">
              <ActionForm action={createProbe} submit="Create probe">
                <label>Name<input name="name" required maxLength={80} placeholder="HQ probe" /></label>
              </ActionForm>
            </div>
          </section>
        )}
      </div>
      <section className="card">
        <div className="card-head"><h2>Install a probe</h2></div>
        <div className="card-body">
          <p className="sub" style={{ marginTop: 0 }}>
            Run it on any always-on machine that can reach the devices (Linux VM, Windows server, or Docker).
            Replace <code>TOKEN</code> with the probe token; it is stored in a file only administrators / root can read. Use an HTTPS server address in production: SNMP credentials travel in the probe&apos;s config.
          </p>
          <h3 style={{ fontSize: '1rem' }}>Docker</h3>
          <pre>{docker}</pre>
          <h3 style={{ fontSize: '1rem' }}>Linux (systemd)</h3>
          <pre>{linux}</pre>
          <h3 style={{ fontSize: '1rem' }}>Windows (PowerShell as Administrator)</h3>
          <pre>{windows}</pre>
        </div>
      </section>
    </>
  );
}
