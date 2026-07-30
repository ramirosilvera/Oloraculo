import { useMemo, useState } from 'react';
import { Landmark, Plus, Trash2 } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes } from '../hooks/usePosiciones';
import { useBrokers } from '../hooks/useBrokers';
import { resumenPorBroker } from '../engine/brokers';
import { unitValueUSD } from '../lib/valuation';
import { Card, CardHeader, Button, Badge, Field, inputCls, Empty, fmtUsdCompact, fmtPct } from '../components/ui';

// Brokers: dónde está físicamente cada posición. Información MÍNIMA a propósito — nombre,
// patrimonio USD, % y cantidad de posiciones. Nada de tickers, P&L ni gráficos: eso ya vive en
// Posiciones, esto es solo el corte "¿cuánto tengo en cada broker?".
export function BrokersPage() {
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const { data: brokers, isLoading: brokersLoading, add, remove } = useBrokers();

  const equity = posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const arStocks = posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker);
  const { data: quotes = {} } = useQuotes(equity, bonds, arStocks);

  // Mismo criterio de valuación que Posiciones (unitValueUSD, fallback a costo sin cotización) —
  // no se inventa una fuente de precio nueva. Solo posiciones ABIERTAS: una cerrada no está "en"
  // ningún broker hoy.
  const resumen = useMemo(() => {
    const rows = posiciones.filter(p => p.cantidad > 0).map(p => {
      const live = quotes[p.ticker] ?? null;
      const unit = unitValueUSD(p, live);
      const valorUsd = unit != null ? unit * p.cantidad : p.precio_compra * p.cantidad;
      return { brokerId: p.broker_id, valorUsd };
    });
    return resumenPorBroker(rows, brokers);
  }, [posiciones, quotes, brokers]);

  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const agregar = async () => {
    if (!nombre.trim()) { setErr('Ingresá un nombre.'); return; }
    setBusy(true); setErr(null);
    try { await add(nombre); setNombre(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo agregar'); }
    finally { setBusy(false); }
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Brokers · {active.nombre}</h1>

      <Card>
        <CardHeader title="Agregar broker" sub="Ej. Invertir Online, Santander. Después asigná cada posición desde su editor en Posiciones." />
        <div className="p-4 flex flex-wrap items-end gap-2">
          <Field label="Nombre" className="flex-1 min-w-[160px]">
            <input value={nombre} onChange={e => setNombre(e.target.value)} className={inputCls} placeholder="ej. Invertir Online" />
          </Field>
          <Button onClick={agregar} disabled={busy}><Plus className="w-4 h-4" /> Agregar</Button>
        </div>
        {err && <p className="px-4 pb-3 text-xs text-warn">{err}</p>}
      </Card>

      <Card>
        <CardHeader title="Patrimonio por broker" sub={`Portfolio activo: ${active.nombre} · valuado igual que Posiciones.`} />
        {resumen.length === 0 ? (
          <Empty icon={Landmark} title="Sin posiciones abiertas">Cuando tengas posiciones abiertas, van a aparecer acá agrupadas por broker.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead className="text-[11px] text-ink-600 border-b border-line">
                <tr>
                  <th className="text-left px-4 py-2">Broker</th>
                  <th className="text-right px-3">Patrimonio</th>
                  <th className="text-right px-3">%</th>
                  <th className="text-right px-4">Posiciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {resumen.map(r => (
                  <tr key={r.brokerId ?? 'sin-asignar'} className="hover:bg-canvas">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold ${r.brokerId == null ? 'text-ink-500' : 'text-ink-900'}`}>{r.nombre}</span>
                        {r.brokerId == null && <Badge tone="warn">asignar</Badge>}
                      </div>
                    </td>
                    <td className={`text-right px-3 tnum font-semibold ${r.brokerId == null ? 'text-ink-500' : 'text-ink-900'}`}>{fmtUsdCompact(r.valorUsd)}</td>
                    <td className="text-right px-3 tnum text-ink-600">{fmtPct(r.pct, 0)}</td>
                    <td className="text-right px-4 tnum text-ink-600">{r.cantidadPosiciones}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Tus brokers" />
        {brokersLoading ? (
          <p className="p-4 text-sm text-ink-600">Cargando…</p>
        ) : brokers.length === 0 ? (
          <Empty icon={Landmark} title="Sin brokers cargados">Agregá el primero arriba.</Empty>
        ) : (
          <div className="divide-y divide-line">
            {brokers.map(b => (
              <div key={b.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                <span className="text-ink-800">{b.nombre}</span>
                <button onClick={() => { if (window.confirm(`¿Borrar "${b.nombre}"? Sus posiciones quedan sin asignar.`)) remove(b.id); }}
                  className="text-ink-500 hover:text-neg inline-flex items-center justify-center w-8 h-8" title="Borrar" aria-label="Borrar">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
