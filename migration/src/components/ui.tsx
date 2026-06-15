// Componentes base reutilizables con estética WC2026

import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary', size = 'md', loading, children, disabled, className = '', ...rest
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary:   'bg-wc-navy text-white hover:bg-wc-navy-light focus:ring-wc-navy',
    secondary: 'bg-white text-wc-navy border border-wc-navy/20 hover:bg-wc-cream focus:ring-wc-navy',
    ghost:     'text-gray-600 hover:bg-gray-100 focus:ring-gray-300',
    danger:    'bg-wc-red text-white hover:bg-red-700 focus:ring-wc-red',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };
  return (
    <button
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
type BadgeColor = 'blue' | 'green' | 'red' | 'gold' | 'gray' | 'navy';
interface BadgeProps { children: ReactNode; color?: BadgeColor; }

export function Badge({ children, color = 'blue' }: BadgeProps) {
  const colors: Record<BadgeColor, string> = {
    blue:  'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    red:   'bg-red-50 text-red-700 border-red-100',
    gold:  'bg-amber-50 text-amber-700 border-amber-100',
    gray:  'bg-gray-100 text-gray-600 border-gray-200',
    navy:  'bg-wc-navy/10 text-wc-navy border-wc-navy/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-md border ${colors[color]}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-2xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-5 py-4 border-b border-gray-100 ${className}`}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------
interface StatCardProps { label: string; value: string | number; icon: ReactNode; color?: string; }
export function StatCard({ label, value, icon, color = 'text-wc-navy' }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
          <p className={`text-3xl font-black mt-1 ${color}`}>{value}</p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-wc-navy/5 flex items-center justify-center text-wc-navy">
          {icon}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ProbBar — barra de probabilidades Home / Empate / Away
// ---------------------------------------------------------------------------
interface ProbBarProps {
  home: number; draw: number; away: number;
  homeLabel?: string; awayLabel?: string;
  size?: 'sm' | 'md';
}
export function ProbBar({ home, draw, away, homeLabel, awayLabel, size = 'md' }: ProbBarProps) {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const h = size === 'sm' ? 'h-4' : 'h-6';
  const fontSize = size === 'sm' ? 'text-[9px]' : 'text-[11px]';
  return (
    <div className="space-y-1">
      <div className={`flex ${h} rounded-lg overflow-hidden ${fontSize} font-bold`}>
        <div
          className="bg-wc-navy flex items-center justify-center text-white transition-all min-w-0"
          style={{ width: pct(home) }}
        >
          {home > 0.12 && pct(home)}
        </div>
        <div
          className="bg-gray-400 flex items-center justify-center text-white transition-all min-w-0"
          style={{ width: pct(draw) }}
        >
          {draw > 0.1 && pct(draw)}
        </div>
        <div
          className="bg-wc-red flex items-center justify-center text-white transition-all min-w-0"
          style={{ width: pct(away) }}
        >
          {away > 0.12 && pct(away)}
        </div>
      </div>
      {(homeLabel || awayLabel) && (
        <div className="flex justify-between text-[10px] text-gray-400 font-medium">
          <span>{homeLabel}</span>
          <span className="text-gray-300">Empate</span>
          <span>{awayLabel}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} />;
}

export function SkeletonCard() {
  return (
    <Card className="p-5 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tooltip simple
// ---------------------------------------------------------------------------
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-52 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg text-center leading-relaxed">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// SectionTitle
// ---------------------------------------------------------------------------
export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-black text-wc-navy">{children}</h1>
      {sub && <p className="text-gray-500 mt-1 text-sm">{sub}</p>}
    </div>
  );
}
