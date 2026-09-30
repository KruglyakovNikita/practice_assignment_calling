import type { ReactNode } from 'react';

export function Card(props: { step: string; title: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{props.step}</div>
          <h2 className="text-lg font-semibold">{props.title}</h2>
          {props.hint && <p className="mt-1 text-sm text-slate-500">{props.hint}</p>}
        </div>
        {props.aside}
      </header>
      <div className="space-y-4">{props.children}</div>
    </section>
  );
}

export function Button(props: { onClick: () => void; disabled?: boolean; children: ReactNode; variant?: 'primary' | 'secondary' | 'danger' }) {
  const variant = props.variant ?? 'secondary';
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
    secondary: 'border border-slate-300 bg-white hover:bg-slate-50',
    danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50'
  }[variant];
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; mono?: boolean; multiline?: boolean }) {
  const className = `mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm ${props.mono ? 'font-mono text-xs' : ''}`;
  return (
    <label className="block text-xs font-medium text-slate-600">
      {props.label}
      {props.multiline ? (
        <textarea className={`${className} min-h-20`} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input className={className} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </label>
  );
}

const badgeColors: Record<string, string> = {
  idle: 'bg-slate-100 text-slate-600',
  queued: 'bg-slate-200 text-slate-700',
  dialing: 'bg-sky-100 text-sky-800',
  in_progress: 'bg-blue-100 text-blue-800',
  streaming: 'bg-blue-100 text-blue-800',
  reconnecting: 'bg-amber-100 text-amber-800',
  partial: 'bg-orange-100 text-orange-800',
  pending: 'bg-amber-100 text-amber-800',
  delivering: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  no_answer: 'bg-violet-100 text-violet-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
  dead: 'bg-red-100 text-red-800',
  cancelled: 'bg-zinc-200 text-zinc-700'
};

export function Badge(props: { value: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold ${badgeColors[props.value] ?? 'bg-slate-100'}`}>{props.value}</span>;
}

export function KeyValue(props: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {props.rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-slate-500">{key}</dt>
          <dd className="break-all font-mono text-xs leading-5">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice(props: { tone: 'error' | 'info'; children: ReactNode }) {
  const tone = props.tone === 'error' ? 'bg-red-50 text-red-900' : 'bg-slate-50 text-slate-700';
  return <p className={`rounded-lg p-3 text-sm ${tone}`}>{props.children}</p>;
}

export const time = (value: string | null | undefined) => (value ? new Date(value).toLocaleTimeString() : null);
