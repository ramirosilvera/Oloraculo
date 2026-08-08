// Renderers genéricos para tarjetas atómicas del Dashboard personalizable — pintan un MetricValue
// (engine/dashboardCatalog.ts) sin saber de dónde salió el número. Cada componente de métrica
// (components/dashboard/metrics.tsx) hace el cálculo real (siempre reusando el hook/engine que ya
// usa la sección equivalente) y entrega acá solo el resultado tipado.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { useChartTheme } from '../../hooks/usePrefs';
import { fmtUsd, fmtUsdCompact, fmtNum, fmtPct, fmtArsCompact } from '../ui';
import type { Formato, MetricValue, Tono } from '../../engine/dashboardCatalog';

function fmtValor(n: number | null, format: Formato | undefined): string {
  if (n == null) return '—';
  switch (format) {
    case 'usd': return fmtUsd(n, 0);
    case 'usd-compact': return fmtUsdCompact(n);
    case 'pct': return fmtPct(n);
    case 'ars-compact': return fmtArsCompact(n);
    default: return fmtNum(n, 2);
  }
}

const TONO_CLASE: Record<Tono, string> = {
  pos: 'text-pos', neg: 'text-neg', warn: 'text-warn', neutral: 'text-ink-900',
};

export function LoadingViz() {
  return <p className="p-4 text-sm text-ink-600">Cargando…</p>;
}

export function EmptyViz({ motivo }: { motivo: string }) {
  return <p className="p-4 text-sm text-ink-600">{motivo}</p>;
}

export function StatViz({ mv }: { mv: Extract<MetricValue, { status: 'ok'; shape: 'scalar' }> }) {
  return (
    <div className="p-4">
      <p className={`text-2xl font-bold font-display tnum ${TONO_CLASE[mv.tone ?? 'neutral']}`}>
        {mv.label ?? fmtValor(mv.value, mv.format)}
      </p>
      {mv.sub && <p className="text-[11px] text-ink-500 mt-1">{mv.sub}</p>}
    </div>
  );
}

export function DonutViz({ mv }: { mv: Extract<MetricValue, { status: 'ok'; shape: 'categorico' }> }) {
  const chart = useChartTheme();
  const total = mv.items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="p-4 grid sm:grid-cols-[minmax(0,160px)_1fr] gap-4 items-center">
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={mv.items} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={40} outerRadius={68} paddingAngle={2} stroke="none">
              {mv.items.map((it, i) => <Cell key={it.label} fill={it.color ?? `hsl(${(i * 47) % 360} 55% 55%)`} />)}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [fmtValor(v, mv.format), n]}
              contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1.5">
        {mv.items.map((it, i) => (
          <div key={it.label} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color ?? `hsl(${(i * 47) % 360} 55% 55%)` }} />
            <span className="font-semibold text-ink-800 truncate">{it.label}</span>
            <span className="tnum text-ink-700 ml-auto">{total > 0 ? fmtPct(it.value / total, 0) : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarViz({ mv }: { mv: Extract<MetricValue, { status: 'ok'; shape: 'categorico' }> }) {
  const chart = useChartTheme();
  return (
    <div className="p-2 h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={mv.items} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={chart.axis} fontSize={11} />
          <YAxis stroke={chart.axis} fontSize={11} tickFormatter={v => fmtValor(v, mv.format)} width={56} />
          <Tooltip formatter={(v: number) => fmtValor(v, mv.format)}
            contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, fontSize: 12, color: chart.tooltipText }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {mv.items.map((it, i) => <Cell key={it.label} fill={it.color ?? `hsl(${(i * 47) % 360} 55% 55%)`} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TableViz({ mv }: { mv: Extract<MetricValue, { status: 'ok'; shape: 'categorico' }> }) {
  const total = mv.items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="px-4 py-3 space-y-1.5">
      {mv.items.map(it => (
        <div key={it.label} className="flex items-center gap-2 text-sm">
          {it.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color }} />}
          <span className="font-semibold text-ink-800 truncate">{it.label}</span>
          <span className="tnum text-ink-700 ml-auto">{fmtValor(it.value, mv.format)}</span>
          <span className="tnum text-[11px] text-ink-500 w-12 text-right">{total > 0 ? fmtPct(it.value / total, 0) : '—'}</span>
        </div>
      ))}
    </div>
  );
}
