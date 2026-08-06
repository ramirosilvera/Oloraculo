import { useEffect, useState } from 'react';
import { Landmark, Pencil, X, CalendarClock } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, usePosicionMutations, useQuotes } from '../hooks/usePosiciones';
import { Card, CardHeader, Button, Badge, Field, Empty, inputCls, fmtUsdCompact, fmtNum, fmtPct } from '../components/ui';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useChartTheme, useIsDark } from '../hooks/usePrefs';
import { ytm, bondDuration } from '../engine/coupons';
import type { Posicion } from '../types/domain';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FREC: Record<number, string> = { 1: 'Anual', 2: 'Semestral', 4: 'Trimestral', 12: 'Mensual' };

// Objetivo de "corto plazo" (años de duración) y qué % del capital en bonos querés ahí — es una
// preferencia de visualización personal (no afecta cálculos de otras pantallas), así que se
// persiste en localStorage por portfolio, igual que el patrón de usePrefs.ts.
const DEFAULT_ANIOS = 2;
const DEFAULT_PCT = 60;
function useObjetivoDuracion(portfolioId: string | undefined) {
  const key = portfolioId ? `bonos.objetivoDuracion.${portfolioId}` : null;
  const [anios, setAniosState] = useState(DEFAULT_ANIOS);
  const [pct, setPctState] = useState(DEFAULT_PCT);

  useEffect(() => {
    let a = DEFAULT_ANIOS, p = DEFAULT_PCT;
    try {
      const raw = key ? localStorage.getItem(key) : null;
      if (raw) {
        const o = JSON.parse(raw);
        if (Number.isFinite(o.anios) && o.anios > 0) a = o.anios;
        if (Number.isFinite(o.pct) && o.pct >= 0 && o.pct <= 100) p = o.pct;
      }
    } catch { /* */ }
    setAniosState(a); setPctState(p);
  }, [key]);

  const persist = (a: number, p: number) => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ anios: a, pct: p })); } catch { /* */ }
  };
  return {
    anios, pct,
    setAnios: (a: number) => { setAniosState(a); persist(a, pct); },
    setPct: (p: number) => { setPctState(p); persist(anios, p); },
  };
}

export function BonosPage() {
  const { active } = usePortfolios();
  const { data: posiciones = [], isLoading: posLoading } = usePosiciones(active?.id);
  const { update } = usePosicionMutations(active?.id);
  const bonos = posiciones.filter(p => p.tipo === 'bono');
  const { data: quotes = {} } = useQuotes([], bonos.map(b => b.ticker));
  const [editBono, setEditBono] = useState<Posicion | null>(null);
  const hoy = new Date().toISOString().slice(0, 10);
  const { anios: objAnios, pct: objPct, setAnios: setObjAnios, setPct: setObjPct } = useObjetivoDuracion(active?.id);
  const chart = useChartTheme();
  const dark = useIsDark();

  if (!active) return null;

  // Un solo cálculo por bono (capital, mercado, TIR, duración) — la tabla y el gráfico lo comparten,
  // así no se recalcula la TIR/duración dos veces con el mismo dato.
  const bonosCalc = bonos.map(b => {
    const px = quotes[b.ticker] ?? null;               // precio por nominal (data912/100)
    const paridad = px != null ? px * 100 : null;      // en %
    const capital = b.precio_compra * b.cantidad;
    const mkt = px != null ? px * b.cantidad : null;
    const res = mkt != null ? mkt - capital : null;
    const cuponOk = b.cupon_tasa != null && b.cupon_frecuencia != null && b.cupon_mes != null;
    // TIR al vencimiento sobre el precio de MERCADO (si no hay, sobre el costo).
    const precioNominal = px ?? (b.precio_compra > 0 ? b.precio_compra : null);
    const tir = precioNominal != null && b.cupon_tasa != null && b.cupon_frecuencia != null && b.vencimiento
      ? ytm({ precio: precioNominal, tasaAnual: b.cupon_tasa, frecuencia: b.cupon_frecuencia, vencimiento: b.vencimiento, hoy })
      : null;
    // Duración: se descuenta a la MISMA TIR de arriba (consistencia, ver engine/coupons.ts).
    const duracion = tir != null && b.cupon_tasa != null && b.cupon_frecuencia != null && b.vencimiento
      ? bondDuration({ tasaAnual: b.cupon_tasa, frecuencia: b.cupon_frecuencia, vencimiento: b.vencimiento, hoy, ytmAnual: tir })
      : null;
    return { pos: b, px, paridad, capital, mkt, res, cuponOk, tir, duracion, capitalUsado: mkt ?? capital };
  });

  const totalCapital = bonosCalc.reduce((s, b) => s + b.capital, 0);
  const totalMkt = bonosCalc.reduce((s, b) => s + (b.mkt ?? b.capital), 0);

  // Gráfico y objetivo: solo entran los bonos con duración calculable (cupón + vencimiento cargados,
  // y no vencidos). `duracionAnios` es un campo plano (no `duracion.macaulay`) a propósito: el eje X
  // del ScatterChart de recharts necesita un `dataKey` que resuelva a un número directamente — con
  // un objeto anidado, el dominio del eje se calcula mal y los puntos no se posicionan.
  const puntos = bonosCalc
    .filter(b => b.duracion != null && b.capitalUsado > 0)
    .map(b => ({ ...b, duracionAnios: b.duracion!.macaulay }));
  const sinDuracion = bonosCalc.filter(b => b.duracion == null);
  const sinDuracionVencidos = sinDuracion.filter(b => b.pos.vencimiento != null && b.pos.vencimiento <= hoy);
  const sinDuracionIncompletos = sinDuracion.filter(b => !(b.pos.vencimiento != null && b.pos.vencimiento <= hoy));
  const capitalConDuracion = puntos.reduce((s, b) => s + b.capitalUsado, 0);
  const duracionPromedio = capitalConDuracion > 0
    ? puntos.reduce((s, b) => s + b.duracion!.macaulay * b.capitalUsado, 0) / capitalConDuracion
    : null;
  const capitalCortoPlazo = puntos.filter(b => b.duracion!.macaulay <= objAnios).reduce((s, b) => s + b.capitalUsado, 0);
  const pctCortoPlazo = capitalConDuracion > 0 ? capitalCortoPlazo / capitalConDuracion : null;
  const cumpleObjetivo = pctCortoPlazo != null && pctCortoPlazo * 100 >= objPct;

  const posColor = dark ? '#15A34A' : '#15803D';
  const accentColor = '#4F97D4';
  const warnColor = dark ? '#E0952B' : '#B45309';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Renta fija · {active.nombre}</h1>
      <Card>
        <CardHeader title="Bonos y ONs" sub="Precio por nominal (data912). Editá el cupón (✏️) para que aparezcan en el calendario de Cupones."
          right={<span className="text-xs text-ink-600 tnum">Capital {fmtUsdCompact(totalCapital)} · Mercado {fmtUsdCompact(totalMkt)}</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <th className="text-left px-4 py-2">Especie</th>
                <th className="text-right px-3">Nominales</th>
                <th className="text-right px-3">Capital</th>
                <th className="text-right px-3">Paridad</th>
                <th className="text-right px-3">Valor mercado</th>
                <th className="text-right px-3">Resultado</th>
                <th className="text-right px-3">Cupón</th>
                <th className="text-right px-3">TIR (YTM)</th>
                <th className="text-right px-3">Duración</th>
                <th className="text-right px-3">Venc.</th>
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bonosCalc.map(bc => {
                const b = bc.pos;
                return (
                  <tr key={b.id} className="hover:bg-canvas align-top">
                    <td className="px-4 py-2" title={b.notas ?? undefined}>
                      <span className="font-semibold text-ink-900">{b.ticker}</span>
                      {(b.empresa || b.notas) && <span className="block text-[10px] text-ink-600 max-w-[220px] truncate">{b.empresa || b.notas}</span>}
                    </td>
                    <td className="text-right px-3 tnum">{fmtNum(b.cantidad, 0)}</td>
                    <td className="text-right px-3 tnum text-ink-700">{fmtUsdCompact(bc.capital)}</td>
                    <td className="text-right px-3 tnum text-accent">{bc.paridad != null ? fmtPct(bc.paridad / 100, 1) : '—'}</td>
                    <td className="text-right px-3 tnum">{fmtUsdCompact(bc.mkt)}</td>
                    <td className={`text-right px-3 tnum ${bc.res == null ? '' : bc.res >= 0 ? 'text-pos' : 'text-neg'}`}>{bc.res == null ? '—' : `${bc.res >= 0 ? '+' : ''}${fmtUsdCompact(bc.res)}`}</td>
                    <td className="text-right px-3 tnum">
                      {bc.cuponOk
                        ? <span className="text-ink-800">{fmtPct(b.cupon_tasa!, 1)}<span className="text-[10px] text-ink-500"> · {FREC[b.cupon_frecuencia!] ?? `${b.cupon_frecuencia!}/año`}</span></span>
                        : <span className="text-warn text-[11px]">sin cupón</span>}
                    </td>
                    <td className="text-right px-3 tnum">
                      {bc.tir != null
                        ? <span className={bc.tir >= 0 ? 'text-pos font-semibold' : 'text-neg'}>{fmtPct(bc.tir, 1)}</span>
                        : <span className="text-ink-500">—</span>}
                    </td>
                    <td className="text-right px-3 tnum">
                      {bc.duracion != null
                        ? <span className={bc.duracion.macaulay <= objAnios ? 'text-pos' : 'text-ink-700'}>{fmtNum(bc.duracion.macaulay, 1)}a</span>
                        : <span className="text-ink-500">—</span>}
                    </td>
                    <td className="text-right px-3 tnum text-ink-600">{b.vencimiento ?? '—'}</td>
                    <td className="px-2 text-right">
                      <button onClick={() => setEditBono(b)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Editar cupón" aria-label="Editar cupón"><Pencil className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
              {posLoading
                ? <tr><td colSpan={11}><p className="p-4 text-sm text-ink-600">Cargando…</p></td></tr>
                : bonos.length === 0 && <tr><td colSpan={11}><Empty icon={Landmark} title="Sin bonos ni ONs">Agregá uno en Posiciones con el tipo "Bono / ON".</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {bonos.length > 0 && (
        <Card>
          <CardHeader title="Duración vs. capital"
            sub="Cada punto es un bono: eje X = duración (Macaulay, años, sensibilidad a la tasa) · eje Y = capital. Definí tu propio objetivo de corto plazo."
            right={pctCortoPlazo != null &&
              <Badge tone={cumpleObjetivo ? 'pos' : 'warn'}>
                {fmtPct(pctCortoPlazo, 0)} a ≤{objAnios}a (objetivo {objPct}%)
              </Badge>} />
          <div className="px-4 py-3 flex flex-wrap gap-3 items-end text-sm border-b border-line">
            <Field label="Corto plazo hasta (años)">
              <input type="number" min="0.25" step="0.25" value={objAnios}
                onChange={e => {
                  // `Number(x) || DEFAULT` trataba "0" (mientras se tipea "0.25") como vacío y saltaba
                  // al default — no se podía escribir 0.25/0.5/0.75 a mano. Vacío sí cae al default.
                  if (e.target.value === '') { setObjAnios(DEFAULT_ANIOS); return; }
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setObjAnios(Math.max(0.25, n));
                }}
                className={`${inputCls} w-24`} />
            </Field>
            <Field label="Objetivo (% del capital)">
              <input type="number" min="0" max="100" step="5" value={objPct}
                onChange={e => setObjPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                className={`${inputCls} w-24`} />
            </Field>
            {duracionPromedio != null && (
              <p className="text-[11px] text-ink-600 ml-auto">Duración promedio ponderada: <span className="tnum font-semibold text-ink-800">{fmtNum(duracionPromedio, 1)} años</span></p>
            )}
          </div>
          {puntos.length > 0 ? (
            <div className="p-2">
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="duracionAnios" name="Duración" unit="a" stroke={chart.axis} fontSize={11}
                    domain={[0, (max: number) => Math.max(max, objAnios) * 1.15]} />
                  <YAxis type="number" dataKey="capitalUsado" name="Capital" stroke={chart.axis} fontSize={11}
                    tickFormatter={v => fmtUsdCompact(v)} width={64} />
                  <ZAxis type="number" range={[80, 320]} dataKey="capitalUsado" />
                  <ReferenceLine x={objAnios} stroke={warnColor} strokeDasharray="4 4"
                    label={{ value: `objetivo ${objAnios}a`, position: 'insideTopRight', fill: chart.axis, fontSize: 10 }} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }}
                    content={({ active: on, payload }) => {
                      if (!on || !payload?.length) return null;
                      const d = payload[0].payload as typeof puntos[number];
                      return (
                        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, color: chart.tooltipText }}>
                          <p className="font-semibold mb-1">{d.pos.ticker}</p>
                          <p>Duración: {fmtNum(d.duracion!.macaulay, 1)} años</p>
                          <p>Capital: {fmtUsdCompact(d.capitalUsado)}</p>
                          {d.tir != null && <p>TIR: {fmtPct(d.tir, 1)}</p>}
                        </div>
                      );
                    }} />
                  <Scatter data={puntos} name="Bonos">
                    {puntos.map((p, i) => (
                      <Cell key={i} fill={p.duracion!.macaulay <= objAnios ? posColor : accentColor} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="p-4 text-sm text-ink-600">Ningún bono tiene cupón + vencimiento cargados todavía — no se puede estimar duración. Editalos con el ✏️ de la tabla.</p>
          )}
          {sinDuracion.length > 0 && puntos.length > 0 && (
            <p className="px-4 pb-3 text-[11px] text-ink-500">
              No aparecen en el gráfico:{' '}
              {sinDuracionIncompletos.length > 0 && <>falta cupón/vencimiento en {sinDuracionIncompletos.map(b => b.pos.ticker).join(', ')}</>}
              {sinDuracionIncompletos.length > 0 && sinDuracionVencidos.length > 0 && ' · '}
              {sinDuracionVencidos.length > 0 && <>ya vencieron: {sinDuracionVencidos.map(b => b.pos.ticker).join(', ')}</>}
            </p>
          )}
        </Card>
      )}

      {editBono && <CuponModal bono={editBono} onClose={() => setEditBono(null)}
        onSave={async (patch) => { await update(editBono.id, patch); setEditBono(null); }} />}
    </div>
  );
}

// Editar/cargar los datos de cupón de un bono existente (tasa, frecuencia, mes de referencia, venc).
function CuponModal({ bono, onClose, onSave }: { bono: Posicion; onClose: () => void; onSave: (patch: Partial<Posicion>) => Promise<void> }) {
  useEscapeClose(onClose);
  const [tasa, setTasa] = useState(bono.cupon_tasa != null ? String(+(bono.cupon_tasa * 100).toFixed(4)) : '');
  const [freq, setFreq] = useState(bono.cupon_frecuencia != null ? String(bono.cupon_frecuencia) : '');
  const [mes, setMes] = useState(bono.cupon_mes != null ? String(bono.cupon_mes) : '');
  const [vto, setVto] = useState(bono.vencimiento ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    setBusy(true); setErr(null);
    try {
      await onSave({
        cupon_tasa: tasa ? Number(tasa) / 100 : null,
        cupon_frecuencia: freq ? Number(freq) : null,
        cupon_mes: mes ? Number(mes) : null,
        vencimiento: vto || null,
      });
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Cupón ${bono.ticker}`}>
        <Card className="animate-rise">
          <CardHeader title={`Cupón · ${bono.ticker}`} sub="Con estos datos el bono aparece en el calendario de Cupones."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 grid grid-cols-2 gap-3 text-sm">
            <Field label="Tasa cupón (% anual)">
              <input type="number" step="0.05" value={tasa} onChange={e => setTasa(e.target.value)} placeholder="ej. 8" className={inputCls} />
            </Field>
            <Field label="Frecuencia">
              <select value={freq} onChange={e => setFreq(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                <option value="1">Anual</option><option value="2">Semestral</option><option value="4">Trimestral</option><option value="12">Mensual</option>
              </select>
            </Field>
            <Field label="Mes de un pago">
              <select value={mes} onChange={e => setMes(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label="Vencimiento">
              <input type="date" value={vto} onChange={e => setVto(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <p className="px-4 -mt-1 text-[11px] text-ink-500 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" /> El "mes de un pago" alcanza: los demás se derivan por la frecuencia (ej. semestral desde mayo → may y nov).
          </p>
          <p className="px-4 pt-1.5 text-[11px] text-ink-500">
            El calendario asume cupón fijo sobre el nominal actual (bullet). Para bonos que amortizan o con step-up, los pagos posteriores a la amortización quedan sobrestimados.
          </p>
          {err && <p className="px-4 pt-2 text-xs text-warn">{err}</p>}
          <div className="px-4 py-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cupón'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
