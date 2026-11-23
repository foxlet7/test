import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { since } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import { createChannel, createUser, deleteChannel, deleteUser } from '@/app/actions';

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

export default async function Settings() {
  const u = await requireUser('ADMIN');
  const [users, channels] = await Promise.all([
    db.user.findMany({ where: { tenantId: u.tenantId }, orderBy: { email: 'asc' } }),
    db.notifyChannel.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' } }),
  ]);
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Users and where alerts are sent</div></div></div>
      <div className="grid">
        <section className="card">
          <div className="card-head"><h2>Users</h2></div>
          <table>
            <thead><tr><th>User</th><th>Role</th><th className="r">Last login</th><th /></tr></thead>
            <tbody>
              {users.map((x) => (
                <tr key={x.id}>
                  <td><b>{x.name}</b><div className="muted">{x.email}</div></td>
                  <td>{x.role.toLowerCase()}</td>
                  <td className="r muted">{x.lastLoginAt ? since(x.lastLoginAt) + ' ago' : 'never'}</td>
                  <td className="r">{x.id !== u.id && (
                    <form action={deleteUser}><input type="hidden" name="id" value={x.id} /><button className="btn danger small">Remove</button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card-body">
            <ActionForm action={createUser} submit="Add user">
              <div className="row2">
                <label>Name<input name="name" required maxLength={120} /></label>
                <label>Email<input name="email" type="email" required /></label>
              </div>
              <div className="row2">
                <label>Role
                  <select name="role" defaultValue="VIEWER">
                    <option value="VIEWER">Viewer - read only</option>
                    <option value="OPERATOR">Operator - manage devices</option>
                    <option value="ADMIN">Admin - everything</option>
                  </select>
                </label>
                <label>Initial password<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
              </div>
            </ActionForm>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Notifications</h2></div>
          {channels.length === 0 ? (
            <div className="empty"><b>No channels</b>Alerts only show on screen until you add one.</div>
          ) : (
            <table>
              <thead><tr><th>Channel</th><th>Sends</th><th /></tr></thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b><div className="muted">{c.kind} · {hostOf(c.target)}</div></td>
                    <td>{c.minStatus === 'DOWN' ? 'Down + recovery' : 'Warning, down + recovery'}</td>
                    <td className="r"><form action={deleteChannel}><input type="hidden" name="id" value={c.id} /><button className="btn danger small">Remove</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="card-body">
            <ActionForm action={createChannel} submit="Add channel">
              <div className="row2">
                <label>Name<input name="name" required maxLength={80} placeholder="NOC Teams channel" /></label>
                <label>Kind
                  <select name="kind">
                    <option value="teams">Microsoft Teams (incoming webhook)</option>
                    <option value="webhook">Generic webhook (JSON)</option>
                  </select>
                </label>
              </div>
              <label>Webhook URL<input name="target" type="url" required maxLength={1000} /></label>
              <label>Send
                <select name="minStatus">
                  <option value="DOWN">Down and recovery</option>
                  <option value="WARNING">Warning, down and recovery</option>
                </select>
              </label>
            </ActionForm>
          </div>
        </section>
      </div>
    </>
  );
}
