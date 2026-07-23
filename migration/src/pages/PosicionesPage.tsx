import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, LineChart, Table2, History, X, TrendingDown, Eye, EyeOff, Pencil, ShoppingCart, Target } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, usePosicionMutations, useQuotes, useMovimientos } from '../hooks/usePosiciones';
import { useCedearRatios } from '../hooks/useCedearRatios';
import { Card, CardHeader, Button, Badge, Stat, Field, inputCls, Empty, fmtUsd, fmtNum, fmtPct } from '../components/ui';
import { realizedPnl } from '../engine/pnl';
import { montoParaObjetivo, pesoResultante, cantidadPorMonto, aplicarObjetivo, redondearPct } from '../engine/rebalance';
import { UpdatedAt } from '../components/UpdatedAt';
import { unitValueUSD } from '../lib/valuation';
import type { Posicion } from '../types/domain';

type Row = { p: Posicion; live: number | null; unit: number | null; mkt: number | null; cost: number; pnl: number | null; pnlPct: number | null };

export function PosicionesPage() {
  const { active } = usePortfolios();
  const { ratios: cedearRatios, saveRatio } = useCedearRatios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const { add, sell, update, remove, setObjetivos } = usePosicionMutations(active?.id);

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
  const pnlNoReal = rows.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const costoTotal = rows.reduce((s, r) => s + r.cost, 0);

  const { data: allMovs = [] } = useMovimientos(active?.id);
  const realized = useMemo(() => realizedPnl(allMovs), [allMovs]);

  const [form, setForm] = useState<Partial<Posicion>>({ tipo: 'cedear', cantidad: 0, precio_compra: 0 });
  const [showForm, setShowForm] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [histTicker, setHistTicker] = useState<string | null>(null);
  const [sellData, setSellData] = useState<{ pos: Posicion; sugerido: number | null } | null>(null);
  const [editPos, setEditPos] = useState<Posicion | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [simular, setSimular] = useState<{ pos?: Posicion } | null>(null);

  const cerradas = rows.filter(r => r.p.cantidad <= 0).length;
  const visibleRows = showClosed ? rows : rows.filter(r => r.p.cantidad > 0);
  const openRows = rows.filter(r => r.p.cantidad > 0);
  // % objetivo mostrados como enteros que SUMAN 100 exactos (resto mayor), no redondeos sueltos.
  const objetivoPct = redondearPct(openRows.filter(r => r.p.peso_objetivo != null).map(r => ({ id: r.p.id, peso: r.p.peso_objetivo! })));

  // Edición inline del % objetivo con sincronización a 100%: el plan son las posiciones abiertas
  // con objetivo asignado (más la que se está tocando); el resto se reescala solo.
  const setTargetFor = async (pos: Posicion, pctStr: string) => {
    const nuevo = pctStr.trim() === '' ? null : Math.max(0, Math.min(100, Number(pctStr))) / 100;
    if (nuevo != null && !Number.isFinite(nuevo)) return;
    const planIds = new Set(openRows.filter(r => r.p.peso_objetivo != null).map(r => r.p.id));
    planIds.add(pos.id);
    const targeted = openRows.filter(r => planIds.has(r.p.id)).map(r => ({ id: r.p.id, peso_objetivo: r.p.peso_objetivo }));
    const result = aplicarObjetivo(targeted, pos.id, nuevo);
    try { await setObjetivos(result); } catch { /* el input vuelve al valor guardado en el próximo refetch */ }
  };

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
        <div>
          <h1 className="text-2xl font-bold text-ink-900 font-display">Posiciones · {active.nombre}</h1>
          <UpdatedAt icon />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setSimular({})}><ShoppingCart className="w-4 h-4" /> Simular compra</Button>
          <Button onClick={() => {
            // Al abrir, arrancar limpio: sin esto, campos de una carga anterior (incluido cupón)
            // reaparecían y podían mezclarse con el alta siguiente.
            setShowForm(v => { if (!v) { setForm({ tipo: 'cedear', cantidad: 0, precio_compra: 0 }); setFormErr(null); } return !v; });
          }}><Plus className="w-4 h-4" /> Agregar</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Valor de mercado" value={fmtUsd(totalMkt, 0)} />
        <Stat label="Costo" value={fmtUsd(costoTotal, 0)} />
        <Stat label="P&L no realizado" value={fmtUsd(pnlNoReal, 0)} delta={costoTotal > 0 ? pnlNoReal / costoTotal : undefined} hint="ganancia/pérdida de lo que tenés hoy" />
        <Stat label="P&L realizado" value={fmtUsd(realized.total, 0)} hint="resultado de las ventas (según historial)" />
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
        <CardHeader title="Cartera" sub="Al agregar un activo ya existente se consolida (costo promedio ponderado); mirá el historial con el ícono de reloj."
          right={
            <div className="flex items-center gap-3">
              {cerradas > 0 && (
                <button onClick={() => setShowClosed(v => !v)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-600 hover:text-celeste-600">
                  {showClosed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showClosed ? 'Ocultar cerradas' : `Ver cerradas (${cerradas})`}
                </button>
              )}
              <span className="text-xs text-ink-600 tnum">Total {fmtUsd(totalMkt, 0)}</span>
            </div>
          } />
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
              {visibleRows.map(({ p, unit, mkt, pnl, pnlPct }) => {
                const pesoAct = mkt != null && totalMkt > 0 ? mkt / totalMkt : null;
                return (
                  <tr key={p.id} className="hover:bg-canvas">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink-900">{p.ticker}</span>
                        <Badge tone="gray">{p.tipo}</Badge>
                        {p.cantidad <= 0 && <Badge tone="neg">cerrada</Badge>}
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
                    <td className="text-right px-3">
                      {p.cantidad > 0
                        ? <TargetCell pos={p} actual={pesoAct} displayPct={objetivoPct.get(p.id) ?? null} onCommit={v => setTargetFor(p, v)} />
                        : <span className="tnum text-ink-600">—</span>}
                    </td>
                    <td className="px-2 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {p.cantidad > 0 && p.tipo !== 'cash' && (
                          <button onClick={() => setSimular({ pos: p })} className="text-ink-600 hover:text-pos inline-flex items-center justify-center w-9 h-9" title="Comprar / simular" aria-label="Comprar / simular"><ShoppingCart className="w-4 h-4" /></button>
                        )}
                        {p.cantidad > 0 && p.tipo !== 'cash' && (
                          <button onClick={() => setSellData({ pos: p, sugerido: unit ?? p.precio_compra })} className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9" title="Vender" aria-label="Vender"><TrendingDown className="w-4 h-4" /></button>
                        )}
                        <button onClick={() => setEditPos(p)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Editar" aria-label="Editar posición"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setHistTicker(p.ticker)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Historial de movimientos" aria-label="Historial de movimientos"><History className="w-4 h-4" /></button>
                        {p.tipo !== 'bono' && p.tipo !== 'cash' && (
                          <Link to={`/analisis/${p.ticker}`} className="text-ink-600 hover:text-accent inline-flex items-center justify-center w-9 h-9" title="Análisis / DCF" aria-label="Análisis DCF"><LineChart className="w-4 h-4" /></Link>
                        )}
                        <button onClick={() => { if (window.confirm(`¿Borrar ${p.ticker}? Se elimina la posición y su historial. No se puede deshacer.`)) remove(p.id); }} className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9" title="Eliminar" aria-label="Eliminar posición"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && <tr><td colSpan={8}><Empty icon={Table2} title="Sin posiciones todavía">Agregá tu primera posición con el botón "Agregar".</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {histTicker && <MovimientosModal portfolioId={active.id} ticker={histTicker} onClose={() => setHistTicker(null)} />}
      {sellData && <SellModal pos={sellData.pos} sugerido={sellData.sugerido}
        onClose={() => setSellData(null)}
        onSell={async (qty, precio, fecha) => { await sell(sellData.pos, qty, precio, fecha); setSellData(null); }} />}
      {editPos && <EditModal pos={editPos} onClose={() => setEditPos(null)}
        onSave={async (patch) => { await update(editPos.id, patch); setEditPos(null); }} />}
      {simular && <SimularCompraModal openRows={openRows} totalMkt={totalMkt} cedearRatios={cedearRatios}
        initial={simular.pos} onClose={() => setSimular(null)}
        onEjecutar={async (payload) => { await add(payload); setSimular(null); }} />}
    </div>
  );
}

// Celda de peso: muestra el peso actual y permite editar el % objetivo inline (se sincroniza a 100%
// con el resto). Debajo, la desviación actual−objetivo (verde = por debajo → hay lugar para comprar).
function TargetCell({ pos, actual, displayPct, onCommit }: { pos: Posicion; actual: number | null; displayPct: number | null; onCommit: (v: string) => void }) {
  // displayPct viene redondeado a nivel del conjunto (suma 100 exacta), no por celda suelta.
  const fromPos = () => (displayPct != null ? String(displayPct) : '');
  const [val, setVal] = useState(fromPos());
  const [focused, setFocused] = useState(false);
  // Sincronizamos desde la base salvo mientras el usuario tipea (el rebalanceo de otra celda dispara
  // un refetch: sin este guard, pisaría lo que estás escribiendo). Al desenfocar, se re-sincroniza
  // (y así también se limpia un texto inválido que no llegó a guardarse).
  useEffect(() => { if (!focused) setVal(fromPos()); }, [displayPct, focused]);   // eslint-disable-line react-hooks/exhaustive-deps
  const off = actual != null && pos.peso_objetivo != null ? actual - pos.peso_objetivo : null;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="tnum font-medium text-ink-900">{actual != null ? fmtPct(actual, 0) : '—'}</span>
      <div className="flex items-center gap-1 text-ink-500">
        <span className="text-[9px] uppercase">obj</span>
        <input value={val} onChange={e => setVal(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => { onCommit(val); setFocused(false); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="—" inputMode="numeric" aria-label={`Objetivo de ${pos.ticker} en %`}
          className="w-9 text-right text-[11px] bg-canvas border border-line rounded px-1 py-0.5 tnum focus:outline-none focus:ring-1 focus:ring-celeste-300" />
        <span className="text-[9px]">%</span>
      </div>
      {off != null && Math.abs(off) >= 0.005 && (
        <span className={`text-[9px] tnum ${off > 0 ? 'text-warn' : 'text-celeste-600'}`} title={off > 0 ? 'por encima del objetivo' : 'por debajo del objetivo'}>
          {off > 0 ? '+' : ''}{fmtPct(off, 0)}
        </span>
      )}
    </div>
  );
}

const MESES_E = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Edición/corrección directa de una posición (cantidad, costo promedio, objetivo, sector, ratio,
// cupón). Es una corrección manual: no genera movimientos (no es una compra/venta real).
function EditModal({ pos, onClose, onSave }: { pos: Posicion; onClose: () => void; onSave: (patch: Partial<Posicion>) => Promise<void> }) {
  const [cantidad, setCantidad] = useState(String(pos.cantidad));
  const [precio, setPrecio] = useState(String(pos.precio_compra));
  const [objetivo, setObjetivo] = useState(pos.peso_objetivo != null ? String(+(pos.peso_objetivo * 100).toFixed(2)) : '');
  const [sector, setSector] = useState(pos.sector ?? '');
  const [ratio, setRatio] = useState(pos.ratio_cedear != null ? String(pos.ratio_cedear) : '');
  const [cTasa, setCTasa] = useState(pos.cupon_tasa != null ? String(pos.cupon_tasa * 100) : '');
  const [cFreq, setCFreq] = useState(pos.cupon_frecuencia != null ? String(pos.cupon_frecuencia) : '');
  const [cMes, setCMes] = useState(pos.cupon_mes != null ? String(pos.cupon_mes) : '');
  const [vto, setVto] = useState(pos.vencimiento ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    setBusy(true); setErr(null);
    const patch: Partial<Posicion> = {
      cantidad: Number(cantidad) || 0,
      precio_compra: Number(precio) || 0,
      peso_objetivo: objetivo ? Number(objetivo) / 100 : null,
      sector: sector || null,
      ratio_cedear: ratio ? Number(ratio) : null,
    };
    if (pos.tipo === 'bono') {
      patch.cupon_tasa = cTasa ? Number(cTasa) / 100 : null;
      patch.cupon_frecuencia = cFreq ? Number(cFreq) : null;
      patch.cupon_mes = cMes ? Number(cMes) : null;
      patch.vencimiento = vto || null;
    }
    try { await onSave(patch); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <Card className="animate-rise">
          <CardHeader title={`Editar · ${pos.ticker}`} sub="Corrección directa de los datos (no registra compra/venta)."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 grid grid-cols-2 gap-3 text-sm">
            <Field label="Cantidad"><input type="number" value={cantidad} onChange={e => setCantidad(e.target.value)} className={inputCls} /></Field>
            <Field label="Costo promedio (USD)"><input type="number" value={precio} onChange={e => setPrecio(e.target.value)} className={inputCls} /></Field>
            <Field label="% objetivo"><input type="number" value={objetivo} onChange={e => setObjetivo(e.target.value)} className={inputCls} /></Field>
            <Field label="Sector"><input value={sector} onChange={e => setSector(e.target.value)} className={inputCls} /></Field>
            {pos.tipo === 'cedear' && <Field label="Ratio CEDEAR"><input type="number" value={ratio} onChange={e => setRatio(e.target.value)} className={inputCls} /></Field>}
            {pos.tipo === 'bono' && <>
              <Field label="Tasa cupón (% anual)"><input type="number" step="0.1" value={cTasa} onChange={e => setCTasa(e.target.value)} className={inputCls} /></Field>
              <Field label="Frecuencia">
                <select value={cFreq} onChange={e => setCFreq(e.target.value)} className={`${inputCls} appearance-none`}>
                  <option value="">—</option><option value="1">Anual</option><option value="2">Semestral</option><option value="4">Trimestral</option>
                </select>
              </Field>
              <Field label="Mes de pago">
                <select value={cMes} onChange={e => setCMes(e.target.value)} className={`${inputCls} appearance-none`}>
                  <option value="">—</option>{MESES_E.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <Field label="Vencimiento"><input type="date" value={vto} onChange={e => setVto(e.target.value)} className={inputCls} /></Field>
            </>}
          </div>
          {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
          <div className="px-4 pb-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SellModal({ pos, sugerido, onClose, onSell }: {
  pos: Posicion; sugerido: number | null; onClose: () => void;
  onSell: (qty: number, precio: number, fecha: string) => Promise<void>;
}) {
  const [qty, setQty] = useState<string>(String(pos.cantidad));
  const [precio, setPrecio] = useState<string>(sugerido != null ? String(+sugerido.toFixed(2)) : '');
  const [fecha, setFecha] = useState<string>(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const n = Number(qty) || 0;
  const p = Number(precio) || 0;
  const costoProm = pos.precio_compra;
  const resultado = n > 0 ? (p - costoProm) * n : 0;

  const confirmar = async () => {
    if (!(n > 0)) { setErr('Ingresá una cantidad válida.'); return; }
    if (n > pos.cantidad) { setErr(`No podés vender más de ${fmtNum(pos.cantidad, 0)} que tenés.`); return; }
    setBusy(true); setErr(null);
    try { await onSell(n, p, fecha); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo vender'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <Card className="animate-rise">
          <CardHeader title={`Vender · ${pos.ticker}`} sub={`Tenés ${fmtNum(pos.cantidad, 0)} un. · costo prom. ${fmtUsd(pos.precio_compra)}`}
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 grid grid-cols-2 gap-3">
            <Field label="Cantidad a vender">
              <input type="number" value={qty} onChange={e => setQty(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Precio de venta (USD)">
              <input type="number" value={precio} onChange={e => setPrecio(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Fecha" className="col-span-2">
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputCls} />
            </Field>
            <button type="button" onClick={() => setQty(String(pos.cantidad))} className="col-span-2 text-left text-[11px] text-celeste-600 hover:underline">Vender todo ({fmtNum(pos.cantidad, 0)})</button>
          </div>
          <div className="px-4 pb-2 flex items-center justify-between text-sm">
            <span className="text-ink-600">Resultado estimado (vs costo prom.)</span>
            <span className={`tnum font-semibold ${resultado >= 0 ? 'text-pos' : 'text-neg'}`}>{resultado >= 0 ? '+' : ''}{fmtUsd(resultado, 0)}</span>
          </div>
          {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
          <div className="px-4 pb-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="danger" onClick={confirmar} disabled={busy}><TrendingDown className="w-4 h-4" /> {busy ? 'Vendiendo…' : 'Vender'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// Simulador de compra: elegís un activo (existente o nuevo), un método (por monto, por cantidad, o
// "llegar al objetivo") y ves el costo y el peso resultante ANTES de ejecutar. Al ejecutar, se
// consolida con la posición existente (costo promedio) igual que una compra normal.
function SimularCompraModal({ openRows, totalMkt, cedearRatios, initial, onClose, onEjecutar }: {
  openRows: Row[]; totalMkt: number; cedearRatios: Record<string, number>;
  initial?: Posicion; onClose: () => void; onEjecutar: (payload: Partial<Posicion>) => Promise<void>;
}) {
  const comprables = openRows.filter(r => r.p.tipo !== 'cash');
  const [modo, setModo] = useState<'existente' | 'nuevo'>(initial || comprables.length > 0 ? 'existente' : 'nuevo');
  const [selId, setSelId] = useState<string>(initial?.id ?? comprables[0]?.p.id ?? '');
  const [nTicker, setNTicker] = useState('');
  const [nTipo, setNTipo] = useState<Posicion['tipo']>('cedear');
  const [nRatio, setNRatio] = useState('');
  const [precio, setPrecio] = useState('');
  const [metodo, setMetodo] = useState<'monto' | 'cantidad' | 'objetivo'>('objetivo');
  const [montoStr, setMontoStr] = useState('');
  const [cantStr, setCantStr] = useState('');
  const [objStr, setObjStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sel = modo === 'existente' ? comprables.find(r => r.p.id === selId) : undefined;
  const esNuevoCedear = modo === 'nuevo' && nTipo === 'cedear';

  // Al cambiar de activo/modo: precargar precio (valuación viva o costo prom.) y objetivo del activo
  // elegido; en "nuevo" limpiar ambos para no arrastrar los del activo anterior.
  useEffect(() => {
    if (modo === 'existente' && sel) {
      setPrecio(String(+(sel.unit ?? sel.p.precio_compra).toFixed(2)));
      setObjStr(sel.p.peso_objetivo != null ? String(Math.round(sel.p.peso_objetivo * 100)) : '');
    } else if (modo === 'nuevo') {
      setPrecio(''); setObjStr('');
    }
  }, [modo, selId]);   // eslint-disable-line react-hooks/exhaustive-deps
  // CEDEAR nuevo: si la base tiene su ratio, precargarlo.
  useEffect(() => {
    if (esNuevoCedear && nTicker && cedearRatios[nTicker] && !nRatio) setNRatio(String(cedearRatios[nTicker]));
  }, [nTicker, nTipo]);   // eslint-disable-line react-hooks/exhaustive-deps

  const unitPrice = Number(precio) || 0;
  // vi con la MISMA base que el total (totalMkt usa mkt ?? cost): si la posición no tiene precio
  // vivo, contamos su costo — si no, quedaría en 0 acá pero como costo en V y el objetivo daría mal.
  const vi = sel ? (sel.mkt ?? sel.cost) : 0;     // valor actual de la posición
  const V = totalMkt;                              // total actual de la cartera
  const objetivo = objStr ? Math.max(0, Math.min(100, Number(objStr))) / 100 : null;

  // Monto/cantidad según el método elegido.
  let monto = 0;
  if (metodo === 'monto') monto = Number(montoStr) || 0;
  else if (metodo === 'cantidad') monto = (Number(cantStr) || 0) * unitPrice;
  else if (objetivo != null) monto = montoParaObjetivo(vi, V, objetivo);
  const cantidad = metodo === 'cantidad' ? (Number(cantStr) || 0) : cantidadPorMonto(monto, unitPrice);

  const sobreponderada = metodo === 'objetivo' && monto < 0;
  const costo = Math.max(0, monto);
  const pesoNuevo = pesoResultante(vi, V, costo);
  const nuevoProm = sel && sel.p.cantidad + cantidad > 0
    ? (sel.p.cantidad * sel.p.precio_compra + cantidad * unitPrice) / (sel.p.cantidad + cantidad) : unitPrice;

  const ticker = modo === 'existente' ? (sel?.p.ticker ?? '') : nTicker.trim().toUpperCase();
  const puedeEjecutar = !!ticker && unitPrice > 0 && cantidad > 0 && costo > 0
    && !(esNuevoCedear && !(Number(nRatio) > 0));

  const ejecutar = async () => {
    if (!puedeEjecutar) { setErr('Completá activo, precio y monto/cantidad válidos.'); return; }
    setBusy(true); setErr(null);
    // No seteamos peso_objetivo acá: el % objetivo se administra con el editor inline (que mantiene
    // el plan en 100%). Escribirlo directo desde el simulador rompería esa suma. El objetivo del
    // simulador se usa solo para dimensionar la compra.
    const payload: Partial<Posicion> = modo === 'existente'
      ? { ticker: sel!.p.ticker, tipo: sel!.p.tipo, cantidad, precio_compra: unitPrice, ratio_cedear: sel!.p.ratio_cedear }
      : { ticker, tipo: nTipo, cantidad, precio_compra: unitPrice, ratio_cedear: nTipo === 'cedear' ? Number(nRatio) : null };
    try { await onEjecutar(payload); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo ejecutar'); setBusy(false); }
  };

  const tabBtn = (k: typeof metodo, label: string) =>
    <button type="button" onClick={() => setMetodo(k)}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${metodo === k ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600 hover:text-ink-900'}`}>{label}</button>;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <Card className="animate-rise max-h-[90vh] overflow-y-auto">
          <CardHeader title="Simular compra" sub="Mirá el costo y el peso resultante antes de ejecutar."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />

          <div className="p-4 space-y-3 text-sm">
            {/* Activo */}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setModo('existente')} disabled={comprables.length === 0}
                className={`flex-1 px-3 py-1.5 rounded-full text-xs font-semibold ${modo === 'existente' ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600'} disabled:opacity-40`}>Activo existente</button>
              <button type="button" onClick={() => setModo('nuevo')}
                className={`flex-1 px-3 py-1.5 rounded-full text-xs font-semibold ${modo === 'nuevo' ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600'}`}>Nuevo activo</button>
            </div>

            {modo === 'existente' ? (
              <Field label="Posición">
                <select value={selId} onChange={e => setSelId(e.target.value)} className={`${inputCls} appearance-none`}>
                  {comprables.map(r => <option key={r.p.id} value={r.p.id}>{r.p.ticker} · {fmtNum(r.p.cantidad, 0)} un · {fmtUsd(r.mkt, 0)}</option>)}
                </select>
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ticker"><input value={nTicker} onChange={e => setNTicker(e.target.value.toUpperCase())} className={inputCls} placeholder="ej. GOOGL" /></Field>
                <Field label="Tipo">
                  <select value={nTipo} onChange={e => setNTipo(e.target.value as Posicion['tipo'])} className={`${inputCls} appearance-none`}>
                    <option value="cedear">CEDEAR</option><option value="accion">Acción (US)</option><option value="accion_ar">Acción ARG</option><option value="etf">ETF</option><option value="bono">Bono / ON</option>
                  </select>
                </Field>
                {esNuevoCedear && <Field label="Ratio CEDEAR" className="col-span-2"><input type="number" value={nRatio} onChange={e => setNRatio(e.target.value)} className={inputCls} placeholder="subyacentes por CEDEAR" /></Field>}
              </div>
            )}

            <Field label="Precio unitario (USD)" hint={sel?.unit != null ? `valuación viva ${fmtUsd(sel.unit)}` : undefined}>
              <input type="number" value={precio} onChange={e => setPrecio(e.target.value)} className={inputCls} placeholder="USD por unidad" />
            </Field>

            {/* Método */}
            <div>
              <span className="block text-[11px] font-semibold text-ink-600 mb-1">Método</span>
              <div className="flex flex-wrap items-center gap-1.5">{tabBtn('objetivo', 'Llegar al objetivo')}{tabBtn('monto', 'Por monto')}{tabBtn('cantidad', 'Por cantidad')}</div>
            </div>

            {metodo === 'monto' && <Field label="Monto a invertir (USD)"><input type="number" value={montoStr} onChange={e => setMontoStr(e.target.value)} className={inputCls} placeholder="USD" /></Field>}
            {metodo === 'cantidad' && <Field label="Cantidad a comprar"><input type="number" value={cantStr} onChange={e => setCantStr(e.target.value)} className={inputCls} placeholder="unidades" /></Field>}
            {metodo === 'objetivo' && (
              <Field label="% objetivo del activo" hint="cuánto querés que pese en la cartera">
                <input type="number" value={objStr} onChange={e => setObjStr(e.target.value)} className={inputCls} placeholder="ej. 10" />
              </Field>
            )}
          </div>

          {/* Preview */}
          <div className="mx-4 mb-3 rounded-xl bg-canvas ring-1 ring-inset ring-line p-3">
            {sobreponderada ? (
              <p className="text-xs text-warn flex items-center gap-1.5"><Target className="w-4 h-4 shrink-0" /> {ticker || 'El activo'} ya está por encima del objetivo — para llegar deberías vender ~{fmtUsd(Math.abs(monto), 0)}, no comprar.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-[10px] uppercase text-ink-600 font-semibold">Cantidad</p><p className="tnum font-bold text-ink-900 mt-0.5">{cantidad > 0 ? fmtNum(cantidad, cantidad < 10 ? 2 : 0) : '—'}</p></div>
                <div><p className="text-[10px] uppercase text-ink-600 font-semibold">Costo</p><p className="tnum font-bold text-ink-900 mt-0.5">{costo > 0 ? fmtUsd(costo, 0) : '—'}</p></div>
                <div><p className="text-[10px] uppercase text-ink-600 font-semibold">Peso result.</p><p className="tnum font-bold text-celeste-600 mt-0.5">{costo > 0 ? fmtPct(pesoNuevo, 1) : '—'}</p></div>
              </div>
            )}
            {!sobreponderada && costo > 0 && (
              <p className="text-[11px] text-ink-600 mt-2 text-center">
                {sel ? <>Peso hoy {fmtPct(V > 0 ? vi / V : 0, 1)} → {fmtPct(pesoNuevo, 1)} · nuevo costo prom. {fmtUsd(nuevoProm)}</>
                     : <>Nueva posición · pesaría {fmtPct(pesoNuevo, 1)} de la cartera</>}
                {objetivo != null && <> · objetivo {fmtPct(objetivo, 0)}</>}
              </p>
            )}
          </div>

          {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
          <div className="px-4 pb-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={ejecutar} disabled={busy || !puedeEjecutar}><ShoppingCart className="w-4 h-4" /> {busy ? 'Ejecutando…' : 'Ejecutar compra'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function MovimientosModal({ portfolioId, ticker, onClose }: { portfolioId: string; ticker: string; onClose: () => void }) {
  const { data: movs = [], isLoading } = useMovimientos(portfolioId, ticker);
  const totalQty = movs.reduce((s, m) => s + (m.tipo === 'venta' ? -1 : 1) * m.cantidad, 0);
  const realizado = realizedPnl(movs).total;

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
            <div className="px-4 py-3 border-t border-line space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Tenencia neta</span>
                <span className="tnum font-semibold text-ink-900">{fmtNum(totalQty, 0)} un.</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">P&L realizado</span>
                <span className={`tnum font-semibold ${realizado >= 0 ? 'text-pos' : 'text-neg'}`}>{realizado >= 0 ? '+' : ''}{fmtUsd(realizado, 0)}</span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
