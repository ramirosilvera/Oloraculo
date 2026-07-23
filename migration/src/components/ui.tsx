import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// Clase base para inputs/selects/textarea — usala para que todos los controles se vean igual.
export const inputCls =
  'w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-celeste-300 focus:border-celeste-300';

// Campo de formulario con micro-label arriba (mejor que placeholder solo).
export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-semibold text-ink-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-ink-500 mt-1">{hint}</span>}
    </label>
  );
}

// Estado vacío con ícono + microcopy.
export function Empty({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      {Icon && <div className="mx-auto w-11 h-11 rounded-2xl bg-canvas grid place-items-center text-ink-500 mb-3"><Icon className="w-5 h-5" /></div>}
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {children && <p className="text-xs text-ink-600 mt-1 max-w-sm mx-auto leading-relaxed">{children}</p>}
    </div>
  );
}

// ── Marca ─────────────────────────────────────────────────────────────────────
// Isotipo: mosaico celeste con un mini gráfico ascendente (crecimiento) y el sol.
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9BCFEF" /><stop offset="1" stopColor="#4F97D4" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#lg)" />
      <circle cx="29.5" cy="11" r="3.2" fill="#F4C752" />
      <path d="M9 27.5 L17 20.5 L22.5 24.5 L31 15" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="27.5" r="1.9" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ size = 32, hideTextOnMobile = false }: { size?: number; hideTextOnMobile?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 shrink-0">
      <Logo size={size} />
      <span className={`font-display font-extrabold tracking-tight text-ink-900 text-lg leading-none ${hideTextOnMobile ? 'hidden sm:inline' : ''}`}>
        Porta<span className="text-celeste-600">folio</span>
      </span>
    </span>
  );
}

// ── Superficies ───────────────────────────────────────────────────────────────
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}>{children}</div>;
}

export function CardHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
      <div>
        <h3 className="text-sm font-bold text-ink-900 font-display">{title}</h3>
        {sub && <p className="text-[11px] text-ink-600 mt-0.5 leading-snug">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, delta, hint }: { label: string; value: ReactNode; delta?: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-soft px-4 py-3" title={hint}>
      <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold">{label}</p>
      <p className="text-xl font-bold text-ink-900 tnum mt-1 font-display">{value}</p>
      {delta != null && (
        <p className={`text-xs font-semibold tnum mt-0.5 ${delta >= 0 ? 'text-pos' : 'text-neg'}`}>
          {delta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(delta))}
        </p>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'pos' | 'neg' | 'warn' | 'accent' | 'celeste' | 'sol' }) {
  const m: Record<string, string> = {
    gray: 'bg-canvas text-ink-700 ring-1 ring-line',
    pos: 'bg-pos/10 text-pos ring-1 ring-pos/20',
    neg: 'bg-neg/10 text-neg ring-1 ring-neg/20',
    warn: 'bg-warn/10 text-warn ring-1 ring-warn/20',
    accent: 'bg-celeste-100 text-celeste-700 ring-1 ring-celeste-200 dark:bg-celeste-500/20 dark:text-celeste-300 dark:ring-celeste-500/30',
    celeste: 'bg-celeste-100 text-celeste-700 ring-1 ring-celeste-200 dark:bg-celeste-500/20 dark:text-celeste-300 dark:ring-celeste-500/30',
    sol: 'bg-sol-soft text-sol-deep ring-1 ring-sol/30 dark:bg-sol/15 dark:text-sol',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${m[tone]}`}>{children}</span>;
}

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean; type?: 'button' | 'submit'; className?: string;
}) {
  const v: Record<string, string> = {
    primary: 'bg-celeste-500 text-white hover:bg-celeste-600 shadow-glow',
    ghost: 'border border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300',
    danger: 'border border-neg/30 bg-surface text-neg hover:bg-neg/5',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all disabled:opacity-50 disabled:shadow-none active:scale-[0.98] ${v[variant]} ${className}`}>
      {children}
    </button>
  );
}

// ── formatters ───────────────────────────────────────────────────────────────
export const fmtUsd = (n: number | null | undefined, dp = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });

// Compacto para magnitudes grandes (millones M / miles de millones B / billones T, escala en-US) —
// evita que desborden las cajas. Debajo de 1M muestra el número completo (importes chicos exactos).
// Decimales adaptativos: 2 si el número guía es <10 ($1,23 M), 1 si <100, 0 si no (conserva cifras).
export const fmtUsdCompact = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n), sign = n < 0 ? '-' : '';
  const fmt = (v: number, suf: string) => `${sign}$${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${suf}`;
  if (abs >= 1e12) return fmt(abs / 1e12, 'T');
  if (abs >= 1e9) return fmt(abs / 1e9, 'B');
  if (abs >= 1e6) return fmt(abs / 1e6, 'M');
  return fmtUsd(n, 0);
};
export const fmtNum = (n: number | null | undefined, dp = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtPct = (n: number | null | undefined, dp = 1): string =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(dp)}%`;
