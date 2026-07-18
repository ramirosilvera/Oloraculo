import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes } from '../hooks/usePosiciones';
import { project } from '../engine/projection';
import { marketValueUSD, costUSD } from '../lib/valuation';
import { Card, CardHeader, Stat, fmtUsd } from '../components/ui';

const anioActual = 2026;

export function ProyeccionesPage() {
  const { active } = usePortfolios();
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
      <h1 className="text-xl font-bold text-gray-100">Proyección · {active.nombre}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Hoy" value={fmtUsd(valorActual, 0)} hint="patrimonio actual del portfolio" />
        <Stat label={`En ${anios} años`} value={fmtUsd(fin?.valor, 0)} hint={`al ${tasaAnual * 100}% anual`} />
        <Stat label="Aportado total" value={fmtUsd(fin?.aportadoTotal, 0)} />
        <Stat label="Ganancia proyectada" value={fmtUsd(fin?.gananciaAcumulada, 0)} />
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
              <CartesianGrid stroke="#1e2739" strokeDasharray="3 3" />
              <XAxis dataKey="anio" stroke="#6b7280" fontSize={11} />
              <YAxis stroke="#6b7280" fontSize={11} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={44} />
              <Tooltip contentStyle={{ background: '#0e1420', border: '1px solid #2a3446', borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => fmtUsd(v, 0)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Aportado" stroke="#6b7280" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="Patrimonio" stroke="#2dd4bf" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <CardHeader title="Año a año (cada 5)" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead className="text-[11px] text-ink-600 border-b border-ink-700">
              <tr><th className="text-left px-4 py-2">Año</th><th className="text-right px-3">Edad</th>
                <th className="text-right px-3">Aportado</th><th className="text-right px-4">Patrimonio</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {rows.filter((_, i) => i % 5 === 0 || i === rows.length - 1).map(r => (
                <tr key={r.anio}>
                  <td className="px-4 py-1.5 text-gray-300">{r.anio}</td>
                  <td className="text-right px-3 tnum text-ink-600">{r.edad ?? '—'}</td>
                  <td className="text-right px-3 tnum text-ink-600">{fmtUsd(r.aportadoTotal, 0)}</td>
                  <td className="text-right px-4 tnum font-semibold text-accent">{fmtUsd(r.valor, 0)}</td>
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
        className="w-full bg-ink-900 border border-ink-600 rounded px-2 py-1.5 mt-1 tnum" />
    </div>
  );
}
