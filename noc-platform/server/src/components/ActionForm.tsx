'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import type { FormState } from '@/app/actions';

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

// A form bound to a server action: shows the action's error / success inline,
// disables the button while saving, clears itself after a successful create.
export function ActionForm({ action, children, submit = 'Save', resetOnOk = true, className = 'stack' }: {
  action: Action; children: ReactNode; submit?: string; resetOnOk?: boolean; className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnOk) ref.current?.reset(); }, [state, resetOnOk]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <div className="error" role="alert">{state.error}</div>}
      {state?.ok && <div className="notice" role="status">{state.ok}</div>}
      {state?.token && (
        <div className="stack">
          <pre aria-label="Probe token">{state.token}</pre>
          <button type="button" className="btn ghost small" onClick={() => navigator.clipboard?.writeText(state.token!)}>Copy token</button>
        </div>
      )}
      <div><button className="btn" type="submit" disabled={pending}>{pending ? 'Saving…' : submit}</button></div>
    </form>
  );
}
