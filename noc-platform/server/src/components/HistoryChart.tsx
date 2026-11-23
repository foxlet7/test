'use client';

import { useEffect, useState } from 'react';

type Row = { ts: string; value: number | null; ok: boolean };

// Line of the primary value with failed checks shaded red. Plain SVG, no chart library.
export function HistoryChart({ sensorId, unit }: { sensorId: string; unit: string }) {
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    setRows(null);
    fetch(`/api/sensors/${sensorId}/history?hours=${hours}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => live && setRows(j.rows))
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [sensorId, hours]);

  const W = 1000, H = 160;
  let body = <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--muted)">{err || (rows ? 'No data in this period yet' : 'Loading…')}</text>;
  let max = 0;
  if (rows && rows.length) {
    const t0 = Date.now() - hours * 3600e3, span = hours * 3600e3;
    const vals = rows.filter((r) => r.value != null).map((r) => r.value as number);
    max = Math.max(1, ...vals) * 1.15;
    const x = (ts: string) => ((new Date(ts).getTime() - t0) / span) * W;
    const y = (v: number) => H - (v / max) * (H - 8) - 4;
    const d = rows.filter((r) => r.value != null).map((r, i) => `${i ? 'L' : 'M'}${x(r.ts).toFixed(1)},${y(r.value as number).toFixed(1)}`).join('');
    body = (
      <>
        {rows.filter((r) => !r.ok).map((r) => <rect key={r.ts} className="bad" x={x(r.ts) - 2} y={0} width={4} height={H} />)}
        <path className="v" d={d} />
      </>
    );
  }
  return (
    <div>
      <div className="actions" style={{ justifyContent: 'space-between', marginBottom: '.4rem' }}>
        <span className="muted">{max ? `0 – ${max.toFixed(max < 10 ? 1 : 0)} ${unit}` : ''}</span>
        <span>{[1, 24, 168, 720].map((h) => (
          <button key={h} type="button" className={'btn small ' + (h === hours ? '' : 'ghost')} onClick={() => setHours(h)} style={{ marginLeft: '.3rem' }}>
            {h === 1 ? '1 h' : h === 24 ? '24 h' : h === 168 ? '7 d' : '30 d'}
          </button>
        ))}</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Sensor history">{body}</svg>
    </div>
  );
}
