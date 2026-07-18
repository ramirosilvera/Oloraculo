import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, LineChart, Table2, History, X } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, usePosicionMutations, useQuotes, useMovimientos } from '../hooks/usePosiciones';
import { useCedearRatios } from '../hooks/useCedearRatios';
import { Card, CardHeader, Button, Badge, Field, inputCls, Empty, fmtUsd, fmtNum, fmtPct } from '../components/ui';
import { unitValueUSD } from '../lib/valuation';
import type { Posicion } from '../types/domain';

export function PosicionesPage() {
  const { active } = usePortfolios();
  const { ratios: cedearRatios, saveRatio } = useCedearRatios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const { add, remove } = usePosicionMutations(active?.id);

  const equity = posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const arStocks = posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker);
  const { data: quotes = {} } = useQuotes(equity, bonds, arStocks);

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
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [histTicker, setHistTicker] = useState<string | null>(null);

  // Pre-llena el ratio de un CEDEAR desde la base (si existe y el usuario no lo tipeó).
  const applyAuto = (f: Partial<Posicion>): Partial<Posicion> => {
    if (f.tipo === 'cedear' && f.ticker && cedearRatios[f.ticker] && !f.ratio_cedear) {
      return { ...f, ratio_cedear: cedearRatios[f.ticker] };
    }
    return f;
  };

  const guardar = async () => {
    if (!form.ticker) { setFormErr('Ingresá el ticker.'); return; }
    if (form.tipo === 'cedear' && !(form.ratio_cedear && form.ratio_cedear > 0)) {
      setFormErr('Un CEDEAR necesita su ratio (subyacentes por CEDEAR) — sin eso el valor se calcula mal.'); return;
    }
    setSaving(true); setFormErr(null);
    try {
      await add(form);
      // Si es CEDEAR y no estaba en la base, la enriquecemos con este ratio.
      if (form.tipo === 'cedear' && form.ticker && form.ratio_cedear && !cedearRatios[form.ticker]) {
        void saveRatio(form.ticker, form.ratio_cedear);
      }
      setShowForm(false);
      setForm({ tipo: 'cedear', cantidad: 0, precio_compra: 0 });
    } catch (e) {
      setFormErr(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`);
    } finally { setSaving(false); }
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Posiciones · {active.nombre}</h1>
        <Button onClick={() => setShowForm(v => !v)}><Plus className="w-4 h-4" /> Agregar</Button>
      </div>

      {showForm && (
        <Card>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <Field label="Tipo">
              <select value={form.tipo} onChange={e => setForm(f => applyAuto({ ...f, tipo: e.target.value as Posicion['tipo'] }))}
                className={`${inputCls} appearance-none`}>
                <option value="cedear">CEDEAR</option>
                <option value="accion">Acción (US)</option>
                <option value="accion_ar">Acción ARG</option>
                <option value="etf">ETF</option>
                <option value="bono">Bono / ON</option>
                <option value="cash">Cash</option>
              </select>
            </Field>
            <Field label="Ticker">
              <input placeholder="Ticker" value={form.ticker ?? ''} onChange={e => setForm(f => applyAuto({ ...f, ticker: e.target.value.toUpperCase() }))} className={inputCls} />
            </Field>
            <Field label="Cantidad">
              <input placeholder="Cantidad" type="number" onChange={e => setForm({ ...form, cantidad: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Precio compra (USD)">
              <input placeholder="Precio compra USD" type="number" onChange={e => setForm({ ...form, precio_compra: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Ratio CEDEAR">
              <input placeholder={form.tipo === 'cedear' ? 'Ratio (auto)' : 'Ratio (CEDEAR)'} type="number" value={form.ratio_cedear ?? ''} onChange={e => setForm({ ...form, ratio_cedear: Number(e.target.value) || null })} className={inputCls} />
            </Field>
            <Field label="% objetivo">
              <input placeholder="% objetivo (0-100)" type="number" onChange={e => setForm({ ...form, peso_objetivo: e.target.value ? Number(e.target.value) / 100 : null })} className={inputCls} />
            </Field>
            <Field label="Sector">
              <input placeholder="Sector" onChange={e => setForm({ ...form, sector: e.target.value })} className={`${inputCls} text-base sm:text-sm`} />
            </Field>
            <div className="flex items-end">
              <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
            </div>
          </div>
          {form.tipo === 'bono' && (
            <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm border-t border-line pt-3">
              <div className="col-span-2 sm:col-span-4 text-[11px] text-ink-600">Datos de cupón (para el flujo de cupones):</div>
              <Field label="Tasa cupón (% anual)">
                <input placeholder="Tasa cupón % anual" type="number" step="0.1" value={form.cupon_tasa != null ? form.cupon_tasa * 100 : ''}
                  onChange={e => setForm({ ...form, cupon_tasa: e.target.value ? Number(e.target.value) / 100 : null })}
                  className={inputCls} />
              </Field>
              <Field label="Frecuencia">
                <select value={form.cupon_frecuencia ?? ''} onChange={e => setForm({ ...form, cupon_frecuencia: e.target.value ? Number(e.target.value) : null })}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Frecuencia…</option>
                  <option value="1">Anual</option>
                  <option value="2">Semestral</option>
                  <option value="4">Trimestral</option>
                </select>
              </Field>
              <Field label="Mes de pago">
                <select value={form.cupon_mes ?? ''} onChange={e => setForm({ ...form, cupon_mes: e.target.value ? Number(e.target.value) : null })}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Mes de pago…</option>
                  {['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Vencimiento">
                <input placeholder="Vencimiento" type="date" value={form.vencimiento ?? ''}
                  onChange={e => setForm({ ...form, vencimiento: e.target.value || null })}
                  className={inputCls} />
              </Field>
            </div>
          )}
          {formErr && <p className="px-4 pb-3 text-xs text-warn">{formErr}</p>}
        </Card>
      )}

      <Card>
        <CardHeader title="Cartera" sub="Al agregar un activo ya existente se consolida (costo promedio ponderado); mirá el historial con el ícono de reloj." right={<span className="text-xs text-ink-600 tnum">Total {fmtUsd(totalMkt, 0)}</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
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
            <tbody className="divide-y divide-line">
              {rows.map(({ p, unit, mkt, pnl, pnlPct }) => {
                const pesoAct = mkt != null && totalMkt > 0 ? mkt / totalMkt : null;
                return (
                  <tr key={p.id} className="hover:bg-canvas">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink-900">{p.ticker}</span>
                        <Badge tone="gray">{p.tipo}</Badge>
                      </div>
                      {p.sector && <span className="text-[10px] text-ink-600">{p.sector}</span>}
                    </td>
                    <td className="text-right px-3 tnum">{fmtNum(p.cantidad, 0)}</td>
                    <td className="text-right px-3 tnum text-ink-700">{fmtUsd(p.precio_compra)}</td>
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
                    <td className="px-2 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setHistTicker(p.ticker)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Historial de movimientos"><History className="w-4 h-4" /></button>
                        {p.tipo !== 'bono' && p.tipo !== 'cash' && (
                          <Link to={`/analisis/${p.ticker}`} className="text-ink-600 hover:text-accent inline-flex items-center justify-center w-9 h-9" title="Análisis / DCF"><LineChart className="w-4 h-4" /></Link>
                        )}
                        <button onClick={() => { if (window.confirm(`¿Borrar ${p.ticker}? Se elimina la posición y su historial. No se puede deshacer.`)) remove(p.id); }} className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8}><Empty icon={Table2} title="Sin posiciones todavía">Agregá tu primera posición con el botón "Agregar".</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {histTicker && <MovimientosModal portfolioId={active.id} ticker={histTicker} onClose={() => setHistTicker(null)} />}
    </div>
  );
}

function MovimientosModal({ portfolioId, ticker, onClose }: { portfolioId: string; ticker: string; onClose: () => void }) {
  const { data: movs = [], isLoading } = useMovimientos(portfolioId, ticker);
  const totalQty = movs.reduce((s, m) => s + (m.tipo === 'venta' ? -1 : 1) * m.cantidad, 0);
  const totalCost = movs.reduce((s, m) => s + (m.tipo === 'venta' ? -1 : 1) * m.cantidad * m.precio, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <Card className="animate-rise">
          <CardHeader title={`Movimientos · ${ticker}`} sub="Registro de cada compra que consolidó esta posición."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="max-h-[55vh] overflow-y-auto divide-y divide-line">
            {isLoading
              ? <p className="p-4 text-sm text-ink-600">Cargando…</p>
              : movs.length === 0
                ? <Empty icon={History} title="Sin movimientos">Las compras que hagas quedarán registradas acá.</Empty>
                : movs.map(m => (
                  <div key={m.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    <span className="text-ink-600 tnum w-24 shrink-0">{m.fecha}</span>
                    <Badge tone={m.tipo === 'compra' ? 'pos' : m.tipo === 'venta' ? 'neg' : 'gray'}>{m.tipo}</Badge>
                    <span className="flex-1 text-right text-ink-700 tnum">{fmtNum(m.cantidad, 0)} × {fmtUsd(m.precio)}</span>
                    <span className="font-semibold tnum text-ink-900 w-24 text-right">{fmtUsd(m.cantidad * m.precio, 0)}</span>
                  </div>
                ))}
          </div>
          {movs.length > 0 && (
            <div className="px-4 py-3 border-t border-line flex items-center justify-between text-sm">
              <span className="text-ink-600">Total consolidado</span>
              <span className="tnum font-semibold text-ink-900">{fmtNum(totalQty, 0)} un. · {fmtUsd(totalCost, 0)}</span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
