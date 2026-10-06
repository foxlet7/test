import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { useI18n } from '../i18n';

// ───────── Toasts ─────────
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'bad') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: 'ok' | 'bad' }[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind === 'bad' ? 'bad' : ''}`}>
            {i.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.body.code === 'NETWORK' ? fallback : e.body.message;
  return fallback;
}

// ───────── Async states ─────────
export function StateView({ loading, error, empty, onRetry, children }: { loading: boolean; error: unknown; empty?: boolean; onRetry?: () => void; children: ReactNode }) {
  const { t } = useI18n();
  if (loading) return <div className="state" role="status">{t('state.loading')}</div>;
  if (error) {
    const offline = error instanceof ApiError && error.body.code === 'NETWORK';
    return (
      <div className="state" role="alert">
        <p>{offline ? t('state.offline') : error instanceof ApiError ? error.body.message : t('state.error')}</p>
        {onRetry && <button className="btn" onClick={onRetry}>{t('act.retry')}</button>}
      </div>
    );
  }
  if (empty) return <div className="state">{t('state.empty')}</div>;
  return <>{children}</>;
}

export function Badge({ value }: { value: string }) {
  const good = ['VERIFIED', 'ACTIVE', 'COMPLETED', 'DELIVERED', 'SUCCEEDED', 'PAID', 'VISIBLE', 'RESOLVED', 'ok', 'REFUNDED'];
  const bad = ['REJECTED', 'SUSPENDED', 'CANCELLED', 'FAILED', 'HIDDEN', 'DELETED', 'down'];
  const cls = good.includes(value) ? 'ok' : bad.includes(value) ? 'bad' : 'warn';
  return <span className={`badge ${cls}`}>{value}</span>;
}

// ───────── Table ─────────
export interface Col<T> { header: string; cell: (row: T) => ReactNode; wrap?: boolean }
export function Table<T extends { id?: string }>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c.header}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>{cols.map((c) => <td key={c.header} className={c.wrap ? 'wrap' : undefined}>{c.cell(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage(p: number): void }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('act.prev')}</button>
      <span>{page} / {pages} · {total}</span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('act.next')}</button>
    </div>
  );
}

// ───────── Dialogs ─────────
export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** Confirmation with a mandatory reason: used for every sensitive admin action. */
export function ReasonDialog({ title, confirmLabel, danger, needReason = true, onConfirm, onClose, extra }: { title: string; confirmLabel: string; danger?: boolean; needReason?: boolean; onConfirm(reason: string): Promise<void>; onClose(): void; extra?: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (needReason && reason.trim().length < 3) return setErr(t('dlg.reasonShort'));
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      toast(t('toast.done'));
      onClose();
    } catch (e) {
      setErr(errMsg(e, t('toast.failed')));
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      {extra}
      {needReason && (
        <div className="field">
          <label htmlFor="reason">{t('dlg.reasonLabel')}</label>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
        </div>
      )}
      {err && <div className="error-box" role="alert">{err}</div>}
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>{t('act.cancel')}</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={submit} disabled={busy}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
