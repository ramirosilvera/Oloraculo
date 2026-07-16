import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, LineChart } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, usePosicionMutations, useQuotes } from '../hooks/usePosiciones';
import { Card, CardHeader, Button, Badge, fmtUsd, fmtNum, fmtPct } from '../components/ui';
import type { Posicion } from '../types/domain';

// A CEDEAR settles in USD as (precio_local / ratio); for USD-quoted ETFs/stocks the
// live price IS the value per unit. Bonds price per nominal already /100.
function unitValueUSD(p: Posicion, live: number | null): number | null {
  if (live == null) return null;
  if (p.tipo === 'cedear' && p.ratio_cedear) return live / p.ratio_cedear;
  return live;
}

export function PosicionesPage() {
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const { add, remove } = usePosicionMutations(active?.id);

  const equity = posiciones.filter(p => p.tipo !== 'bono' && p.tipo !== 'cash').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const { data: quotes = {} } = useQuotes(equity, bonds);

  const rows = useMemo(() => posiciones.map(p => {
    const live = quotes[p.ticker] ?? null;
    const unit = unitValueUSD(p, live);
    const mkt = unit != null ? unit * p.cantidad : null;
    const cost = p.precio_compra * p.cantidad;
    const pnl = mkt != null ? mkt - cost : null;
    const pnlPct = mkt != null && cost > 0 ? mkt / cost - 1 : null;
    return { p, live, unit, mkt, cost, pnl, pnlPct };
  }), [posiciones, quotes]);

  const totalMkt = rows.reduce((s, r) => s + (r.mkt ?? r.cost), 0);

  const [form, setForm] = useState<Partial<Posicion>>({ tipo: 'cedear', cantidad: 0, precio_compra: 0 });
  const [showForm, setShowForm] = useState(false);

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-100">Posiciones · {active.nombre}</h1>
        <Button onClick={() => setShowForm(v => !v)}><Plus className="w-4 h-4" /> Agregar</Button>
      </div>

      {showForm && (
        <Card>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value as Posicion['tipo'] })}
              className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5">
              <option value="cedear">CEDEAR</option><option value="etf">ETF</option>
              <option value="bono">Bono/ON</option><option value="cash">Cash</option>
            </select>
            <input placeholder="Ticker" value={form.ticker ?? ''} onChange={e => setForm({ ...form, ticker: e.target.value.toUpperCase() })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5" />
            <input placeholder="Cantidad" type="number" onChange={e => setForm({ ...form, cantidad: Number(e.target.value) })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5" />
            <input placeholder="Precio compra USD" type="number" onChange={e => setForm({ ...form, precio_compra: Number(e.target.value) })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5" />
            <input placeholder="Ratio (CEDEAR)" type="number" onChange={e => setForm({ ...form, ratio_cedear: Number(e.target.value) || null })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5" />
            <input placeholder="% objetivo (0-100)" type="number" onChange={e => setForm({ ...form, peso_objetivo: e.target.value ? Number(e.target.value) / 100 : null })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5" />
            <input placeholder="Sector" onChange={e => setForm({ ...form, sector: e.target.value })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5" />
            <Button onClick={async () => { if (form.ticker) { await add(form); setShowForm(false); setForm({ tipo: 'cedear', cantidad: 0, precio_compra: 0 }); } }}>Guardar</Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Cartera" sub="Precio en vivo (celeste) = del sistema · el resto lo cargás vos." right={<span className="text-xs text-ink-600 tnum">Total {fmtUsd(totalMkt, 0)}</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-[11px] text-ink-600 border-b border-ink-700">
              <tr>
                <th className="text-left px-4 py-2">Activo</th>
                <th className="text-right px-3">Cant.</th>
                <th className="text-right px-3">Compra</th>
                <th className="text-right px-3">Actual</th>
                <th className="text-right px-3">Mercado</th>
                <th className="text-right px-3">P&L</th>
                <th className="text-right px-3">Peso</th>
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {rows.map(({ p, unit, mkt, pnl, pnlPct }) => {
                const pesoAct = mkt != null && totalMkt > 0 ? mkt / totalMkt : null;
                return (
                  <tr key={p.id} className="hover:bg-ink-700/30">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-100">{p.ticker}</span>
                        <Badge tone="gray">{p.tipo}</Badge>
                      </div>
                      {p.sector && <span className="text-[10px] text-ink-600">{p.sector}</span>}
                    </td>
                    <td className="text-right px-3 tnum">{fmtNum(p.cantidad, 0)}</td>
                    <td className="text-right px-3 tnum text-gray-300">{fmtUsd(p.precio_compra)}</td>
                    <td className="text-right px-3 tnum text-accent">{unit != null ? fmtUsd(unit) : '—'}</td>
                    <td className="text-right px-3 tnum">{fmtUsd(mkt)}</td>
                    <td className={`text-right px-3 tnum ${pnl == null ? '' : pnl >= 0 ? 'text-pos' : 'text-neg'}`}>
                      {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${fmtUsd(pnl, 0)}`}
                      {pnlPct != null && <span className="block text-[10px]">{fmtPct(pnlPct)}</span>}
                    </td>
                    <td className="text-right px-3 tnum">
                      {pesoAct != null ? fmtPct(pesoAct, 0) : '—'}
                      {p.peso_objetivo != null && <span className="block text-[10px] text-ink-600">obj {fmtPct(p.peso_objetivo, 0)}</span>}
                    </td>
                    <td className="px-3 text-right whitespace-nowrap">
                      {p.tipo !== 'bono' && p.tipo !== 'cash' && (
                        <Link to={`/analisis/${p.ticker}`} className="text-ink-600 hover:text-accent inline-block mr-2" title="Análisis / DCF"><LineChart className="w-4 h-4" /></Link>
                      )}
                      <button onClick={() => remove(p.id)} className="text-ink-600 hover:text-neg inline-block" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-600">Sin posiciones. Agregá la primera.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
