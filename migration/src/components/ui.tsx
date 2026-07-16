import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-ink-700 bg-ink-800/60 ${className}`}>{children}</div>;
}

export function CardHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-ink-700">
      <div>
        <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
        {sub && <p className="text-[11px] text-ink-600 mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, delta, hint }: { label: string; value: ReactNode; delta?: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2.5" title={hint}>
      <p className="text-[10px] uppercase tracking-wide text-ink-600">{label}</p>
      <p className="text-lg font-bold text-gray-100 tnum mt-0.5">{value}</p>
      {delta != null && (
        <p className={`text-xs font-semibold tnum ${delta >= 0 ? 'text-pos' : 'text-neg'}`}>
          {delta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(delta))}
        </p>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'pos' | 'neg' | 'warn' | 'accent' }) {
  const m: Record<string, string> = {
    gray: 'bg-ink-700 text-gray-300',
    pos: 'bg-pos/15 text-pos',
    neg: 'bg-neg/15 text-neg',
    warn: 'bg-warn/15 text-warn',
    accent: 'bg-accent/15 text-accent',
  };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${m[tone]}`}>{children}</span>;
}

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean; type?: 'button' | 'submit'; className?: string;
}) {
  const v: Record<string, string> = {
    primary: 'bg-accent text-ink-950 hover:bg-accent/90',
    ghost: 'border border-ink-600 text-gray-300 hover:bg-ink-700',
    danger: 'border border-neg/40 text-neg hover:bg-neg/10',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${v[variant]} ${className}`}>
      {children}
    </button>
  );
}

// ── formatters ───────────────────────────────────────────────────────────────
export const fmtUsd = (n: number | null | undefined, dp = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtNum = (n: number | null | undefined, dp = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtPct = (n: number | null | undefined, dp = 1): string =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(dp)}%`;
