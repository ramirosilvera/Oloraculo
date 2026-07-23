import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes, useMacro } from '../hooks/usePosiciones';
import { useAportes } from '../hooks/useAportes';
import { useFlujo } from '../hooks/useFlujo';
import { useChartTheme } from '../hooks/usePrefs';
import { SEMAFOROS, resumenMacro, type Luz, type Lectura, type ResumenMacro } from '../engine/semaforos';
import { resumenFlujo } from '../engine/flujo';
import { portfolioTir } from '../engine/irr';
import { api } from '../lib/api';
import { useUltimoAnalisis, useSetUltimoAnalisis } from '../hooks/useAnalisisIA';
import { Card, CardHeader, Stat, Button, Badge, fmtUsd, fmtPct } from '../components/ui';
import { fmtArs } from './FinanzasPage';
import { UpdatedAt } from '../components/UpdatedAt';
import { unitValueUSD as unitUSD } from '../lib/valuation';

const LUZ_DOT: Record<Luz, string> = { verde: 'bg-pos', amarillo: 'bg-warn', rojo: 'bg-neg' };
// Paleta categórica estable para el donut (funciona en claro y oscuro).
const PIE = ['#4F97D4', '#F4C752', '#5FB49C', '#B08BD6', '#E08E6D', '#9BCFEF', '#7A8CA5', '#D45F7A', '#63B7C9', '#C7A15A'];

export function DashboardPage() {
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const equity = posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const arStocks = posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker);
  const { data: quotes = {} } = useQuotes(equity, bonds, arStocks);
  const { data: macro = {} } = useMacro();
  const { data: aportes = [] } = useAportes(active?.id);
  const { data: flujo = [] } = useFlujo();

  const { patrimonio, costo, pnl, alloc } = useMemo(() => {
    let patrimonio = 0, costo = 0;
    const parts: { ticker: string; mkt: number; target: number | null }[] = [];
    for (const p of posiciones) {
      const u = unitUSD(p, quotes[p.ticker] ?? null);
      const mkt = u != null ? u * p.cantidad : p.precio_compra * p.cantidad;
      patrimonio += mkt;
      costo += p.precio_compra * p.cantidad;
      if (mkt > 0) parts.push({ ticker: p.ticker, mkt, target: p.peso_objetivo });
    }
    parts.sort((a, b) => b.mkt - a.mkt);
    return { patrimonio, costo, pnl: patrimonio - costo, alloc: parts };
  }, [posiciones, quotes]);

  // TIR money-weighted: aportes (capital externo) + patrimonio actual como flujo terminal.
  const tir = useMemo(() => portfolioTir({
    aportes: aportes.map(a => ({ monto: a.monto, fecha: a.fecha, retiro: a.tipo === 'retiro' })),
    costos: posiciones.filter(p => p.cantidad > 0).map(p => ({ costo: p.precio_compra * p.cantidad, fecha: p.fecha_compra })),
    valorActual: patrimonio,
    hoy: new Date().toISOString().slice(0, 10),
  }), [aportes, posiciones, patrimonio]);

  const semaforos: Lectura[] = SEMAFOROS.map(s => {
    const v = (macro as Record<string, number | null>)[s.key];
    return { def: s, valor: v ?? null, luz: v != null ? s.evalua(v) : null };
  });
  const resumen = resumenMacro(semaforos);

  const mep = (macro as Record<string, number | null>).dolar_mep ?? (macro as Record<string, number | null>).dolar_ccl ?? null;
  const flujoR = resumenFlujo(flujo, mep);
  const objetivo = active?.capital_objetivo ?? null;

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Dashboard · {active.nombre}</h1>
        <UpdatedAt icon />
      </div>

      {/* Hero: lo esencial, sin repetir. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label="Patrimonio" value={fmtUsd(patrimonio, 0)} hint={`costo ${fmtUsd(costo, 0)}`} />
        <Stat label="P&L" value={<span className={pnl >= 0 ? 'text-pos' : 'text-neg'}>{fmtUsd(pnl, 0)}</span>} delta={costo > 0 ? pnl / costo : undefined} />
        <Stat label={`TIR anual${tir.aproximada ? ' ~' : ''}`}
          value={<span className={tir.anual == null ? '' : tir.anual >= 0 ? 'text-pos' : 'text-neg'}>{tir.anual != null ? fmtPct(tir.anual) : '—'}</span>}
          hint={tir.base === 'aportes' ? 'XIRR sobre tus aportes' : tir.base === 'costos' ? 'aprox. (sin aportes cargados)' : 'cargá aportes para calcularla'} />
        <Stat label="TIR histórica"
          value={<span className={tir.historica == null ? '' : tir.historica >= 0 ? 'text-pos' : 'text-neg'}>{tir.historica != null ? fmtPct(tir.historica) : '—'}</span>}
          hint="rendimiento total acumulado" />
      </div>

      {/* Progreso hacia el objetivo de capital. */}
      {objetivo != null && objetivo > 0 && (
        <Card>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="font-semibold text-ink-800">Objetivo de capital</span>
              <span className="tnum text-ink-600">{fmtUsd(patrimonio, 0)} / {fmtUsd(objetivo, 0)}</span>
            </div>
            <div className="h-2.5 rounded-full bg-canvas overflow-hidden">
              <div className="h-full rounded-full bg-celeste-500" style={{ width: `${Math.min(100, (patrimonio / objetivo) * 100)}%` }} />
            </div>
            <p className="text-[11px] text-ink-600 mt-1.5 tnum">
              {fmtPct(patrimonio / objetivo, 0)} alcanzado
              {patrimonio < objetivo && <> · faltan {fmtUsd(objetivo - patrimonio, 0)}</>}
            </p>
          </div>
        </Card>
      )}

      {/* Distribución: donut + actual vs objetivo. */}
      <Distribucion alloc={alloc} total={patrimonio} />

      {flujo.length > 0 && <LiquidezFci resumen={flujoR} mep={mep} />}

      <MacroContext readings={semaforos} resumen={resumen} />
    </div>
  );
}

function Distribucion({ alloc, total }: { alloc: { ticker: string; mkt: number; target: number | null }[]; total: number }) {
  const chart = useChartTheme();
  if (alloc.length === 0) {
    return <Card><CardHeader title="Distribución" /><p className="p-4 text-sm text-ink-600">Sin posiciones. Cargalas en Posiciones.</p></Card>;
  }
  const data = alloc.map(a => ({ name: a.ticker, value: a.mkt }));
  return (
    <Card>
      <CardHeader title="Distribución" sub="Peso de cada activo · actual vs objetivo." />
      <div className="p-4 grid sm:grid-cols-[minmax(0,200px)_1fr] gap-4 items-center">
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={2} stroke="none">
                {data.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
              </Pie>
              <Tooltip
                formatter={(v: number) => [fmtUsd(v, 0), 'Valor']}
                contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1">
          {alloc.map((a, i) => {
            const w = total > 0 ? a.mkt / total : 0;
            const off = a.target != null ? w - a.target : null;
            return (
              <div key={a.ticker} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE[i % PIE.length] }} />
                <span className="font-semibold text-ink-800 w-14 truncate">{a.ticker}</span>
                <span className="tnum text-ink-700 w-12 text-right">{fmtPct(w, 0)}</span>
                {a.target != null
                  ? <span className="tnum text-[11px] text-ink-500 w-16 text-right">obj {fmtPct(a.target, 0)}</span>
                  : <span className="w-16" />}
                {off != null && Math.abs(off) >= 0.005
                  ? <span className={`tnum text-[10px] w-10 text-right ${off > 0 ? 'text-warn' : 'text-celeste-600'}`}>{off > 0 ? '+' : ''}{fmtPct(off, 0)}</span>
                  : <span className="w-10" />}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// Liquidez & FCI: la parte del flujo de caja que se muestra en el Dashboard (near-cash sleeve).
function LiquidezFci({ resumen, mep }: { resumen: ReturnType<typeof resumenFlujo>; mep: number | null }) {
  const usd = (ars: number) => (mep ? `≈ US$${Math.round(ars / mep).toLocaleString('en-US')}` : '');
  return (
    <Card>
      <CardHeader title="Liquidez & FCI" sub="Fondos y billetera, según tu flujo de caja."
        right={<Link to="/finanzas" className="text-[11px] text-celeste-600 hover:underline">Editar flujo →</Link>} />
      <div className="grid grid-cols-3 gap-2 p-3">
        <Stat label="FCI + billetera" value={fmtArs(resumen.fci)} hint={usd(resumen.fci)} />
        <Stat label="Disponible" value={<span className={resumen.disponible >= 0 ? 'text-pos' : 'text-neg'}>{fmtArs(resumen.disponible)}</span>} hint="ingresos − egresos" />
        <Stat label="Sin asignar" value={<span className={resumen.sinAsignar >= 0 ? 'text-ink-900' : 'text-neg'}>{fmtArs(resumen.sinAsignar)}</span>} hint="todavía sin colocar" />
      </div>
    </Card>
  );
}

const TONE_ALERTA: Record<'amarillo' | 'rojo', 'warn' | 'neg'> = { amarillo: 'warn', rojo: 'neg' };

// Contexto macro: síntesis narrativa (rule-based) + alertas + tablero compacto + lectura de IA.
function MacroContext({ readings, resumen }: { readings: Lectura[]; resumen: ResumenMacro }) {
  const { texto: guardado, fecha } = useUltimoAnalisis('MACRO', 'macro');
  const setUltimo = useSetUltimoAnalisis();
  const [ia, setIa] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const mostrado = ia ?? guardado;
  const conDatos = readings.filter(r => r.luz);

  async function explicar() {
    setBusy(true); setErr(null);
    const r = await api.analisisMacro({
      indicadores: conDatos.map(r => ({ indicador: r.def.label, grupo: r.def.grupo, valor: r.valor != null && r.def.fmt ? r.def.fmt(r.valor) : r.valor, estado: r.luz })),
    });
    if (r.error) setErr(r.error);
    else { setIa(r.analisis ?? ''); if (r.analisis) setUltimo('MACRO', 'macro', r.analisis); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader title="Contexto macro" sub="Semáforos + lectura de la situación."
        right={<Badge tone={resumen.luz === 'rojo' ? 'neg' : resumen.luz === 'amarillo' ? 'warn' : 'pos'}>
          {resumen.titulo} · {resumen.conteo.rojos}🔴 {resumen.conteo.amarillos}🟡
        </Badge>} />

      {/* Síntesis narrativa + alertas. */}
      <div className="px-4 pt-3">
        <p className="text-sm text-ink-800 leading-relaxed">{resumen.parrafo}</p>
        {resumen.alertas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {resumen.alertas.map(a => <Badge key={a.key} tone={TONE_ALERTA[a.luz]}>{a.label}: {a.msg}</Badge>)}
          </div>
        )}
      </div>

      {/* Tablero compacto: chips con punto de color (mucho más condensado que la grilla anterior). */}
      <div className="px-4 pt-3">
        <button onClick={() => setAbierto(v => !v)} className="text-[11px] font-semibold text-celeste-600 hover:underline mb-2">
          {abierto ? 'Ocultar indicadores' : `Ver los ${conDatos.length} indicadores`}
        </button>
        {abierto && (
          <div className="flex flex-wrap gap-1.5">
            {readings.filter(r => r.valor != null).map(({ def, valor, luz }) => (
              <span key={def.key} className="inline-flex items-center gap-1.5 rounded-full bg-canvas ring-1 ring-inset ring-line px-2.5 py-1 text-[11px]">
                <span className={`w-1.5 h-1.5 rounded-full ${luz ? LUZ_DOT[luz] : 'bg-ink-300'}`} />
                <span className="text-ink-600">{def.label}</span>
                <span className="tnum font-semibold text-ink-900">{def.fmt ? def.fmt(valor!) : valor}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Lectura de IA (opcional, persistida). */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" onClick={explicar} disabled={busy || conDatos.length === 0}>
            <Sparkles className="w-4 h-4" /> {busy ? 'Analizando…' : mostrado ? 'Volver a analizar' : 'Explicar la situación (IA)'}
          </Button>
          {err && <span className="text-[11px] text-neg">No se pudo generar: {err}</span>}
        </div>
        {mostrado && (
          <div className="mt-2 rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2.5">
            <p className="text-sm text-ink-800 leading-relaxed whitespace-pre-wrap break-words">{mostrado}</p>
            <p className="text-[10px] text-ink-600 mt-1.5">Lectura cualitativa por IA · los valores los calcula el código.{!ia && fecha && ` · guardada ${new Date(fecha).toLocaleString('es-AR')}`}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
