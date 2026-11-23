// Display helpers shared by the NOC wall, tables and reports.

export function fmtValue(v: number | null | undefined, unit?: string | null): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const u = unit || '';
  if (u === 'Mbit/s') return (v >= 1000 ? (v / 1000).toFixed(2) + ' Gbit/s' : (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' Mbit/s');
  if (u === 'ms') return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ms';
  const n = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return u ? `${n} ${u}` : n;
}

export function fmtDuration(secs: number): string {
  secs = Math.max(0, Math.round(secs));
  if (secs < 60) return secs + 's';
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtMoney(v: number | null | undefined, currency = 'SAR'): string {
  if (v == null || !Number.isFinite(v)) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v);
}

export function fmtPct(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  return v >= 100 ? '100%' : v.toFixed(digits) + '%';
}

export function since(d: Date | string | null | undefined): string {
  if (!d) return '';
  return fmtDuration((Date.now() - new Date(d).getTime()) / 1000);
}
