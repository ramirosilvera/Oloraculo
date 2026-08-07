import { useState } from 'react';
import { Landmark, Pencil, X, CalendarClock } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosicionMutations, useMacro } from '../hooks/usePosiciones';
import { useBonosCalc, useObjetivoDuracion, resumenBonos, alertasBonos, DEFAULT_ANIOS_CORTO_PLAZO } from '../hooks/useBonos';
import { CONCENTRACION_POSICION_ALERTA } from '../engine/bonos';
import { CALIFICADORAS, CALIFICADORAS_CLASIFICABLES, ETIQUETA_GRADO, ETIQUETA_ESCALA, type GradoCredito, type EscalaRating } from '../engine/rating';
import { Card, CardHeader, Button, Badge, Stat, Field, Empty, inputCls, fmtUsdCompact, fmtNum, fmtPct, AlertasBanner } from '../components/ui';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useChartTheme, useIsDark } from '../hooks/usePrefs';
import type { Posicion } from '../types/domain';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FREC: Record<number, string> = { 1: 'Anual', 2: 'Semestral', 4: 'Trimestral', 12: 'Mensual' };
// Gris neutro para "sin calificar" en la barra de calidad crediticia — mismo criterio que
// SIN_ASIGNAR_COLOR en components/ui.tsx (colorDeBroker): no compite con los tonos pos/warn/neg.
const SIN_CALIFICAR_COLOR = '#8B96A5';

// Badge de rating: tono por grado (pos=grado de inversión, warn=especulativo, neg=default,
// gris=sin calificar o 'Otra' calificadora). Nunca inventa un grado que el motor no dio.
// `grado === null` puede ser por 3 motivos DISTINTOS — mezclarlos en un solo mensaje genérico le
// mentiría al usuario en 2 de los 3 casos (ej. decirle "notación desconocida" a un S&P sin nota
// cargada). Cuando SÍ hay grado, el hint siempre aclara la escala (global vs. nacional Arg.) —
// nunca deja que un "grado de inversión" nacional se lea como si fuera comparable al global.
function RatingBadge({ calificadora, calificacion, grado, escala }: {
  calificadora: string | null; calificacion: string | null; grado: GradoCredito | null; escala: EscalaRating | null;
}) {
  if (!calificadora && !calificacion) return <span className="text-ink-500 text-[11px]">—</span>;
  const tone = grado === 'grado_inversion' ? 'pos' : grado === 'especulativo' ? 'warn' : grado === 'default' ? 'neg' : 'gray';
  const clasificable = calificadora != null && (CALIFICADORAS_CLASIFICABLES as readonly string[]).includes(calificadora);
  const hint = grado != null && escala != null
    ? `${calificadora}: ${ETIQUETA_GRADO[grado]} (${ETIQUETA_ESCALA[escala]})`
    : !calificadora ? 'Sin calificadora cargada'
    : !clasificable ? `${calificadora} — notación desconocida, no se clasifica automático`
    : !calificacion ? `${calificadora} — falta cargar la nota`
    : `${calificadora} — "${calificacion}" no matchea ninguna nota conocida de esta escala (¿typo?)`;
  return (
    <span title={hint}>
      <Badge tone={tone}>{calificacion || '—'}{calificadora && <span className="ml-1 text-[9px] opacity-70">{calificadora}</span>}</Badge>
    </span>
  );
}

export function BonosPage() {
  const { active } = usePortfolios();
  const { bonos, bonosCalc, isLoading: posLoading } = useBonosCalc(active?.id);
  const { update } = usePosicionMutations(active?.id);
  const [editBono, setEditBono] = useState<Posicion | null>(null);
  const hoy = new Date().toISOString().slice(0, 10);
  const { anios: objAnios, pct: objPct, setAnios: setObjAnios, setPct: setObjPct } = useObjetivoDuracion(active?.id);
  const chart = useChartTheme();
  const dark = useIsDark();
  const { data: macro = {} } = useMacro();
  const riskFree = (macro as Record<string, number | null>).dgs10 != null ? (macro as Record<string, number | null>).dgs10! / 100 : null;

  if (!active) return null;

  const resumen = resumenBonos(bonosCalc, objAnios, riskFree);
  const { totalCapital, totalMkt, duracionPromedio, tirPromedio, rendCorrientePromedio, spreadPromedio, pctCortoPlazo, mayorPosicion, distribucionGrado } = resumen;
  const alertas = alertasBonos(resumen, objAnios, objPct);

  // Gráfico: solo entran los bonos con duración calculable (cupón + vencimiento cargados, y no
  // vencidos). `duracionAnios` es un campo plano (no `duracion.macaulay`) a propósito: el eje X
  // del ScatterChart de recharts necesita un `dataKey` que resuelva a un número directamente — con
  // un objeto anidado, el dominio del eje se calcula mal y los puntos no se posicionan.
  const puntos = bonosCalc
    .filter(b => b.duracion != null && b.capitalUsado > 0)
    .map(b => ({ ...b, duracionAnios: b.duracion!.macaulay }));
  const sinDuracion = bonosCalc.filter(b => b.duracion == null);
  const sinDuracionVencidos = sinDuracion.filter(b => b.pos.vencimiento != null && b.pos.vencimiento <= hoy);
  const sinDuracionIncompletos = sinDuracion.filter(b => !(b.pos.vencimiento != null && b.pos.vencimiento <= hoy));
  const cumpleObjetivo = pctCortoPlazo != null && pctCortoPlazo * 100 >= objPct;

  const posColor = dark ? '#15A34A' : '#15803D';
  const accentColor = '#4F97D4';
  const warnColor = dark ? '#E0952B' : '#B45309';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Renta fija · {active.nombre}</h1>
      <AlertasBanner alertas={alertas} />
      <Card>
        <CardHeader title="Bonos y ONs" sub="Precio por nominal (data912). Editá el cupón (✏️) para que aparezcan en el calendario de Cupones."
          right={<span className="text-xs text-ink-600 tnum">Capital {fmtUsdCompact(totalCapital)} · Mercado {fmtUsdCompact(totalMkt)}</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <th className="text-left px-4 py-2">Especie</th>
                <th className="text-left px-3">Rating</th>
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
                    <td className="px-3"><RatingBadge calificadora={b.calificadora} calificacion={b.calificacion} grado={bc.grado} escala={bc.escalaGrado} /></td>
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
                      <button onClick={() => setEditBono(b)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Editar cupón y rating" aria-label="Editar cupón y rating"><Pencil className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
              {posLoading
                ? <tr><td colSpan={12}><p className="p-4 text-sm text-ink-600">Cargando…</p></td></tr>
                : bonos.length === 0 && <tr><td colSpan={12}><Empty icon={Landmark} title="Sin bonos ni ONs">Agregá uno en Posiciones con el tipo "Bono / ON".</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {bonos.length > 0 && (
        <Card>
          <CardHeader title="Indicadores clave" sub="Rendimiento, riesgo de crédito y concentración de la cartera de renta fija." />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
            <Stat label="TIR promedio" value={tirPromedio != null
              ? <span className={tirPromedio >= 0 ? 'text-pos' : 'text-neg'}>{fmtPct(tirPromedio)}</span>
              : <span className="text-ink-500">—</span>}
              hint="Promedio ponderado por capital de la TIR (YTM) de cada bono" />
            <Stat label="Rend. corriente" value={rendCorrientePromedio != null ? fmtPct(rendCorrientePromedio) : '—'}
              hint="Cupón/precio, ponderado por capital — a diferencia de la YTM, ignora la ganancia o pérdida de capital hasta el rescate" />
            <Stat label="Spread s/UST10y" value={spreadPromedio != null
              ? <span className={spreadPromedio >= 0 ? 'text-ink-900' : 'text-neg'}>{spreadPromedio >= 0 ? '+' : ''}{fmtPct(spreadPromedio)}</span>
              : <span className="text-ink-500">—</span>}
              hint="TIR promedio menos la tasa libre de riesgo (UST10y) — la prima de riesgo que exige el mercado por esta cartera" />
            <Stat label="Mayor posición" value={mayorPosicion
              ? <span className={mayorPosicion.pct >= CONCENTRACION_POSICION_ALERTA ? 'text-warn' : 'text-ink-900'}>{mayorPosicion.ticker} · {fmtPct(mayorPosicion.pct, 0)}</span>
              : <span className="text-ink-500">—</span>}
              hint={`% del capital en bonos concentrado en un solo ticker — alerta a partir de ${fmtPct(CONCENTRACION_POSICION_ALERTA, 0)}. No agrupa por emisor real: distintas series del mismo emisor (ej. varios bonos soberanos) cuentan aparte.`} />
          </div>
          <div className="px-4 pb-4">
            <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold mb-1.5">Calidad crediticia</p>
            {totalMkt > 0 ? (
              <>
                <div className="h-3 rounded-full overflow-hidden flex bg-canvas ring-1 ring-inset ring-line">
                  {distribucionGrado.gradoInversion > 0 &&
                    <div className="bg-pos h-full" style={{ width: `${distribucionGrado.gradoInversion * 100}%` }} title={`Grado de inversión (dentro de su escala, global o nacional): ${fmtPct(distribucionGrado.gradoInversion, 0)}`} />}
                  {distribucionGrado.especulativo > 0 &&
                    <div className="bg-warn h-full" style={{ width: `${distribucionGrado.especulativo * 100}%` }} title={`Especulativo (dentro de su escala, global o nacional): ${fmtPct(distribucionGrado.especulativo, 0)}`} />}
                  {distribucionGrado.default > 0 &&
                    <div className="bg-neg h-full" style={{ width: `${distribucionGrado.default * 100}%` }} title={`Default: ${fmtPct(distribucionGrado.default, 0)}`} />}
                  {distribucionGrado.sinCalificar > 0 &&
                    <div className="h-full" style={{ width: `${distribucionGrado.sinCalificar * 100}%`, background: SIN_CALIFICAR_COLOR }} title={`Sin calificar (o calificadora "Otra"/nota no reconocida): ${fmtPct(distribucionGrado.sinCalificar, 0)}`} />}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-ink-600">
                  {distribucionGrado.gradoInversion > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pos" />Grado de inversión {fmtPct(distribucionGrado.gradoInversion, 0)}</span>}
                  {distribucionGrado.especulativo > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warn" />Especulativo {fmtPct(distribucionGrado.especulativo, 0)}</span>}
                  {distribucionGrado.default > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-neg" />Default {fmtPct(distribucionGrado.default, 0)}</span>}
                  {distribucionGrado.sinCalificar > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SIN_CALIFICAR_COLOR }} />Sin calificar {fmtPct(distribucionGrado.sinCalificar, 0)}</span>}
                </div>
                <p className="text-[10px] text-ink-500 mt-1.5">
                  Clasificado en escala NACIONAL argentina (FIX SCR/Moody's Local) — la que aplica a la gran mayoría de bonos y ONs locales. No equivale a grado de inversión global (S&amp;P/Moody's/Fitch), que solo aparecería en alguna ON hard-dollar con rating internacional.
                </p>
              </>
            ) : <p className="text-[11px] text-ink-500">Sin capital valuado todavía.</p>}
          </div>
        </Card>
      )}

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
                  if (e.target.value === '') { setObjAnios(DEFAULT_ANIOS_CORTO_PLAZO); return; }
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

// Editar/cargar los datos de un bono existente: cupón (tasa, frecuencia, mes de referencia,
// vencimiento) y calificación crediticia (calificadora + nota).
function CuponModal({ bono, onClose, onSave }: { bono: Posicion; onClose: () => void; onSave: (patch: Partial<Posicion>) => Promise<void> }) {
  useEscapeClose(onClose);
  const [tasa, setTasa] = useState(bono.cupon_tasa != null ? String(+(bono.cupon_tasa * 100).toFixed(4)) : '');
  const [freq, setFreq] = useState(bono.cupon_frecuencia != null ? String(bono.cupon_frecuencia) : '');
  const [mes, setMes] = useState(bono.cupon_mes != null ? String(bono.cupon_mes) : '');
  const [vto, setVto] = useState(bono.vencimiento ?? '');
  const [calificadora, setCalificadora] = useState(bono.calificadora ?? '');
  const [calificacion, setCalificacion] = useState(bono.calificacion ?? '');
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
        calificadora: calificadora || null,
        calificacion: calificacion.trim() || null,
      });
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Detalles de ${bono.ticker}`}>
        <Card className="animate-rise">
          <CardHeader title={`Detalles del bono · ${bono.ticker}`} sub="Cupón para el calendario de Cupones · calificación para el indicador de calidad crediticia."
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
            <Field label="Calificadora">
              <select value={calificadora} onChange={e => setCalificadora(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                {CALIFICADORAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Calificación">
              <input value={calificacion} onChange={e => setCalificacion(e.target.value)} placeholder="ej. BB-, Ba3, AAA(arg)" className={inputCls} />
            </Field>
          </div>
          <p className="px-4 -mt-1 text-[11px] text-ink-500 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" /> El "mes de un pago" alcanza: los demás se derivan por la frecuencia (ej. semestral desde mayo → may y nov).
          </p>
          <p className="px-4 pt-1.5 text-[11px] text-ink-500">
            El calendario asume cupón fijo sobre el nominal actual (bullet). Para bonos que amortizan o con step-up, los pagos posteriores a la amortización quedan sobrestimados.
          </p>
          <p className="px-4 pt-1.5 text-[11px] text-ink-500">
            FIX SCR y Moody's Local (escala nacional argentina, la que vas a usar casi siempre) clasifican en grado de inversión/especulativo/default automáticamente (badge de color). S&amp;P/Moody's/Fitch (escala global) también, solo para el caso puntual de una ON con rating internacional — no equivale a la escala nacional. "Otra" no se clasifica (notación desconocida).
          </p>
          {err && <p className="px-4 pt-2 text-xs text-warn">{err}</p>}
          <div className="px-4 py-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
