'use client';

import { useState } from 'react';

type Opt = { id: string; name: string };
export type DeviceValues = {
  id?: string; name?: string; host?: string; kind?: string; siteId?: string | null; probeId?: string | null;
  snmpVersion?: string | null; snmpCommunity?: string | null; v3?: { user?: string; authProto?: string; privProto?: string } | null;
};

const KINDS = ['generic', 'fortigate', 'cisco', 'mikrotik', 'windows', 'linux', 'sbc', 'pbx', 'printer', 'ups', 'cloud'];

// Shared by "Add device" and "Edit device". SNMP fields appear only for the chosen version.
export function DeviceFields({ sites, probes, v = {}, isNew = true }: { sites: Opt[]; probes: Opt[]; v?: DeviceValues; isNew?: boolean }) {
  const [ver, setVer] = useState(v.snmpVersion || '');
  return (
    <>
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="row2">
        <label>Name<input name="name" required maxLength={120} defaultValue={v.name} placeholder="FGT-HQ-01" /></label>
        <label>Host <span className="hint">IP or DNS name</span><input name="host" required maxLength={253} defaultValue={v.host} placeholder="10.10.0.1" /></label>
      </div>
      <div className="row2">
        <label>Site<select name="siteId" defaultValue={v.siteId || ''}><option value="">(no site)</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Probe <span className="hint">which probe polls it</span>
          <select name="probeId" defaultValue={v.probeId || probes[0]?.id || ''}><option value="">(none - not polled)</option>{probes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label>Type<select name="kind" defaultValue={v.kind || 'generic'}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
      </div>
      <div className="row2">
        <label>SNMP<select name="snmpVersion" value={ver} onChange={(e) => setVer(e.target.value)}>
          <option value="">Not used</option><option value="2c">v2c</option><option value="3">v3 (recommended)</option>
        </select></label>
        {ver === '2c' && <label>Community<input name="snmpCommunity" maxLength={120} defaultValue={v.snmpCommunity || ''} placeholder="public" autoComplete="off" /></label>}
      </div>
      {ver === '3' && (
        <div className="row2">
          <label>User<input name="v3user" maxLength={120} defaultValue={v.v3?.user || ''} required autoComplete="off" /></label>
          <label>Auth<select name="v3authProto" defaultValue={v.v3?.authProto || 'SHA'}><option>SHA</option><option>SHA256</option><option>MD5</option><option value="">none</option></select></label>
          <label>Auth password {!isNew && <span className="hint">blank = keep</span>}<input name="v3authPass" type="password" maxLength={200} autoComplete="new-password" /></label>
          <label>Privacy<select name="v3privProto" defaultValue={v.v3?.privProto || 'AES'}><option>AES</option><option>AES256</option><option>DES</option><option value="">none</option></select></label>
          <label>Privacy password {!isNew && <span className="hint">blank = keep</span>}<input name="v3privPass" type="password" maxLength={200} autoComplete="new-password" /></label>
        </div>
      )}
      {isNew && <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" name="addPing" defaultChecked style={{ width: 'auto' }} /> Add a Ping sensor</label>}
    </>
  );
}
