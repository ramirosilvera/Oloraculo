import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes } from '../hooks/usePosiciones';
import { useChartTheme } from '../hooks/usePrefs';
import { project } from '../engine/projection';
import { marketValueUSD, costUSD } from '../lib/valuation';
import { Card, CardHeader, Stat, fmtUsd, fmtUsdCompact } from '../components/ui';

// Año en curso real: si se hardcodea, a partir del año siguiente el eje temporal y las edades
// quedan desfasados del calendario.
const anioActual = new Date().getFullYear();

export function ProyeccionesPage() {
  const { active } = usePortfolios();
  const chart = useChartTheme();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const equity = posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const arStocks = posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker);
  const { data: quotes = {} } = useQuotes(equity, bonds, arStocks);

  const valorActual = useMemo(
    () => posiciones.reduce((s, p) => s + (marketValueUSD(p, quotes[p.ticker] ?? null) ?? costUSD(p)), 0),
    [posiciones, quotes]);

  const [aporteAnual, setAporteAnual] = useState(3000);
  const [tasaAnual, setTasaAnual] = useState(0.08);
  const [anios, setAnios] = useState(40);
  const [edadInicial, setEdadInicial] = useState(35);

  const rows = useMemo(() => project({
    valorInicial: Math.round(valorActual), aporteAnual, tasaAnual, anios, anioBase: anioActual, edadInicial,
  }), [valorActual, aporteAnual, tasaAnual, anios, edadInicial]);

  const fin = rows[rows.length - 1];
  const chartData = rows.map(r => ({ anio: r.anio, Patrimonio: Math.round(r.valor), Aportado: Math.round(r.aportadoTotal) }));

  if (!active) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Proyección · {active.nombre}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Hoy" value={fmtUsdCompact(valorActual)} hint="patrimonio actual del portfolio" />
        <Stat label={`En ${anios} años`} value={fmtUsdCompact(fin?.valor)} hint={`al ${tasaAnual * 100}% anual`} />
        <Stat label="Aportado total" value={fmtUsdCompact(fin?.aportadoTotal)} />
        <Stat label="Ganancia proyectada" value={fmtUsdCompact(fin?.gananciaAcumulada)} />
      </div>

      <Card>
        <CardHeader title="Supuestos" sub="Interés compuesto + aportes anuales. Editá y se recalcula." />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Num l="Aporte anual (USD)" v={aporteAnual} step={500} onChange={setAporteAnual} />
          <Num l="Retorno anual (%)" v={+(tasaAnual * 100).toFixed(1)} step={0.5} onChange={v => setTasaAnual(v / 100)} />
          <Num l="Años" v={anios} step={5} onChange={setAnios} />
          <Num l="Edad hoy" v={edadInicial} step={1} onChange={setEdadInicial} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Crecimiento proyectado" />
        <div className="p-2 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
              <XAxis dataKey="anio" stroke={chart.axis} fontSize={11} />
              <YAxis stroke={chart.axis} fontSize={11} tickFormatter={v => `US$${(v / 1000).toFixed(0)}k`} width={52} />
              <Tooltip contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, fontSize: 12, color: chart.tooltipText }}
                formatter={(v: number) => fmtUsd(v, 0)} />
              <Legend wrapperStyle={{ fontSize: 11, color: chart.tooltipText }} />
              <Line type="monotone" dataKey="Aportado" stroke={chart.line2} strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="Patrimonio" stroke="#4F97D4" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <CardHeader title="Año a año (cada 5)" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr><th className="text-left px-4 py-2">Año</th><th className="text-right px-3">Edad</th>
                <th className="text-right px-3">Aportado</th><th className="text-right px-4">Patrimonio</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.filter((_, i) => i % 5 === 0 || i === rows.length - 1).map(r => (
                <tr key={r.anio} className="hover:bg-canvas">
                  <td className="px-4 py-1.5 text-ink-700">{r.anio}</td>
                  <td className="text-right px-3 tnum text-ink-600">{r.edad ?? '—'}</td>
                  <td className="text-right px-3 tnum text-ink-600">{fmtUsdCompact(r.aportadoTotal)}</td>
                  <td className="text-right px-4 tnum font-semibold text-accent">{fmtUsdCompact(r.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Num({ l, v, step, onChange }: { l: string; v: number; step: number; onChange: (n: number) => void }) {
  return (
    <div>
      <label className="text-[10px] uppercase text-ink-600">{l}</label>
      <input type="number" step={step} value={v} onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-surface border border-line rounded-xl text-ink-900 px-2 py-1.5 mt-1 tnum focus:outline-none focus:ring-2 focus:ring-celeste-300" />
    </div>
  );
}
