'use client';

import { useState } from 'react';
import { ActionForm } from './ActionForm';
import { createSensor } from '@/app/actions';

const TYPES = [
  ['PING', 'Ping - reachability, latency, loss', 'ms'],
  ['SNMP_TRAFFIC', 'SNMP traffic - interface in/out', 'Mbit/s'],
  ['SNMP_OID', 'SNMP OID - any numeric value', ''],
  ['SNMP_UPTIME', 'SNMP uptime - detects reboots', 'h'],
  ['HTTP', 'HTTP(S) - status, response time, certificate', 'ms'],
  ['TCP', 'TCP port - open and connect time', 'ms'],
  ['DNS', 'DNS - resolve a name on this server', 'ms'],
] as const;

const NAME: Record<string, string> = { PING: 'Ping', SNMP_TRAFFIC: 'Traffic', SNMP_OID: 'SNMP value', SNMP_UPTIME: 'Uptime', HTTP: 'HTTPS', TCP: 'Port', DNS: 'DNS' };

// Fields change with the sensor type; thresholds apply to the primary value (shown unit).
export function SensorForm({ deviceId, host, hasSnmp }: { deviceId: string; host: string; hasSnmp: boolean }) {
  const [type, setType] = useState<string>('PING');
  const unit = TYPES.find((t) => t[0] === type)?.[2] || 'value';
  return (
    <ActionForm action={createSensor} submit="Add sensor">
      <input type="hidden" name="deviceId" value={deviceId} />
      <label>Type
        <select name="type" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map(([v, l]) => <option key={v} value={v} disabled={v.startsWith('SNMP') && !hasSnmp}>{l}{v.startsWith('SNMP') && !hasSnmp ? ' (set SNMP on the device)' : ''}</option>)}
        </select>
      </label>
      <div className="row2">
        <label>Name<input name="name" required maxLength={120} key={type} defaultValue={NAME[type]} /></label>
        <label>Interval (s)<input name="intervalSec" type="number" min={15} max={3600} defaultValue={60} /></label>
      </div>

      {type === 'PING' && <label>Packets per check<input name="count" type="number" min={1} max={10} defaultValue={4} /></label>}
      {type === 'SNMP_TRAFFIC' && (
        <div className="row2">
          <label>Interface name <span className="hint">ifName / ifDescr, e.g. wan1</span><input name="ifName" maxLength={80} /></label>
          <label>or ifIndex<input name="ifIndex" type="number" min={1} /></label>
        </div>
      )}
      {type === 'SNMP_OID' && (
        <div className="row2">
          <label>OID<input name="oid" required maxLength={200} placeholder="1.3.6.1.4.1.12356.101.4.1.3.0" /></label>
          <label>Unit<input name="unit" maxLength={20} placeholder="%" /></label>
          <label>Multiply by<input name="scale" defaultValue="1" /></label>
        </div>
      )}
      {type === 'HTTP' && (
        <>
          <label>URL<input name="url" required maxLength={500} defaultValue={`https://${host}/`} /></label>
          <div className="row2">
            <label>Expect status <span className="hint">blank = any below 400</span><input name="expectStatus" type="number" min={100} max={599} /></label>
            <label>Must contain<input name="keyword" maxLength={200} /></label>
            <label>Certificate warning (days)<input name="tlsWarnDays" type="number" defaultValue={14} min={0} /></label>
          </div>
        </>
      )}
      {type === 'TCP' && <label>Port<input name="port" type="number" min={1} max={65535} required placeholder="443" /></label>}
      {type === 'DNS' && (
        <div className="row2">
          <label>Name to resolve<input name="query" required maxLength={253} placeholder="alasilacx.sa" /></label>
          <label>Expected answer <span className="hint">optional</span><input name="expect" maxLength={200} /></label>
        </div>
      )}

      <details>
        <summary>Thresholds and alerting</summary>
        {/* keyed by type: switching type must not carry e.g. Ping's 150 ms into a traffic sensor */}
        <div className="row2" style={{ marginTop: '.6rem' }} key={type}>
          <label>Warning above ({unit})<input name="warnAbove" inputMode="decimal" defaultValue={type === 'PING' ? '150' : ''} /></label>
          <label>Down above ({unit})<input name="downAbove" inputMode="decimal" /></label>
          <label>Warning below ({unit})<input name="warnBelow" inputMode="decimal" /></label>
          <label>Down below ({unit})<input name="downBelow" inputMode="decimal" /></label>
          <label>Failed checks before DOWN<input name="failAfter" type="number" min={1} max={10} defaultValue={2} /></label>
        </div>
      </details>
    </ActionForm>
  );
}
