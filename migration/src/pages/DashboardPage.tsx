import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes, useMacro, useDrawdowns } from '../hooks/usePosiciones';
import { useAportes } from '../hooks/useAportes';
import { useFlujo } from '../hooks/useFlujo';
import { useChartTheme } from '../hooks/usePrefs';
import { SEMAFOROS, GRUPOS, resumenMacro, distanciaMaximo, type Luz, type Lectura, type ResumenMacro } from '../engine/semaforos';
import { resumenFlujo } from '../engine/flujo';
import { redondearPct } from '../engine/rebalance';
import { portfolioTir } from '../engine/irr';
import { api } from '../lib/api';
import { useUltimoAnalisis, useSetUltimoAnalisis } from '../hooks/useAnalisisIA';
import { Card, CardHeader, Stat, Button, Badge, fmtUsd, fmtUsdCompact, fmtPct } from '../components/ui';
import { fmtArs, fmtArsCompact } from './FinanzasPage';
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
        <Stat label="Patrimonio" value={fmtUsdCompact(patrimonio)} hint={`costo ${fmtUsdCompact(costo)}`} />
        <Stat label="P&L" value={<span className={pnl >= 0 ? 'text-pos' : 'text-neg'}>{fmtUsdCompact(pnl)}</span>} delta={costo > 0 ? pnl / costo : undefined} />
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
              <span className="tnum text-ink-600">{fmtUsdCompact(patrimonio)} / {fmtUsdCompact(objetivo)}</span>
            </div>
            <div className="h-2.5 rounded-full bg-canvas overflow-hidden">
              <div className="h-full rounded-full bg-celeste-500" style={{ width: `${Math.min(100, (patrimonio / objetivo) * 100)}%` }} />
            </div>
            <p className="text-[11px] text-ink-600 mt-1.5 tnum">
              {fmtPct(patrimonio / objetivo, 0)} alcanzado
              {patrimonio < objetivo && <> · faltan {fmtUsdCompact(objetivo - patrimonio)}</>}
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
  // % objetivo mostrados como enteros que suman 100 (resto mayor), coherente con Posiciones.
  const objPct = redondearPct(alloc.filter(a => a.target != null).map(a => ({ id: a.ticker, peso: a.target! })));
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
                  ? <span className="tnum text-[11px] text-ink-500 w-16 text-right">obj {objPct.get(a.ticker) ?? Math.round(a.target * 100)}%</span>
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
// Montos en pesos formateados compactos ($22,9 M) para que no desborden las cajas; el valor exacto
// queda en el tooltip.
function LiquidezFci({ resumen, mep }: { resumen: ReturnType<typeof resumenFlujo>; mep: number | null }) {
  const usd = (ars: number) => (mep ? `≈ US$${Math.round(ars / mep).toLocaleString('en-US')}` : 'liquidez');
  const tiles = [
    { label: 'FCI + billetera', val: resumen.fci, sub: usd(resumen.fci), tone: 'text-ink-900' },
    { label: 'Disponible', val: resumen.disponible, sub: 'ingresos − egresos', tone: resumen.disponible >= 0 ? 'text-pos' : 'text-neg' },
    { label: 'Sin asignar', val: resumen.sinAsignar, sub: 'sin colocar', tone: resumen.sinAsignar >= 0 ? 'text-ink-900' : 'text-neg' },
  ];
  return (
    <Card>
      <CardHeader title="Liquidez & FCI" sub="Fondos y billetera en pesos, según tu flujo de caja."
        right={<Link to="/finanzas" className="text-[11px] text-celeste-600 hover:underline">Editar flujo →</Link>} />
      <div className="grid grid-cols-3 gap-2 p-3">
        {tiles.map(t => (
          <div key={t.label} className="rounded-2xl border border-line bg-surface shadow-soft px-3 py-3 min-w-0" title={fmtArs(t.val)}>
            <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">{t.label}</p>
            <p className={`text-lg font-bold font-display tnum mt-1 truncate ${t.tone}`}>{fmtArsCompact(t.val)}</p>
            <p className="text-[10px] text-ink-500 mt-0.5 truncate">{t.sub}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

const TONE_ALERTA: Record<'amarillo' | 'rojo', 'warn' | 'neg'> = { amarillo: 'warn', rojo: 'neg' };

// Contexto macro: síntesis narrativa (rule-based) + alertas + tablero compacto + lectura de IA.
const DD_ITEMS: { key: string; label: string }[] = [
  { key: 'sp500', label: 'S&P 500' }, { key: 'merval', label: 'Merval' }, { key: 'oro', label: 'Oro' },
];

function MacroContext({ readings, resumen }: { readings: Lectura[]; resumen: ResumenMacro }) {
  const { texto: guardado, fecha } = useUltimoAnalisis('MACRO', 'macro');
  const setUltimo = useSetUltimoAnalisis();
  const { data: dd = {} } = useDrawdowns();
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

  const tone = resumen.luz === 'rojo' ? 'neg' : resumen.luz === 'amarillo' ? 'warn' : 'pos';
  const { verdes, amarillos, rojos, total } = resumen.conteo;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <Card>
      <CardHeader title="Contexto macro" sub="Semáforos + lectura ejecutiva."
        right={<Badge tone={tone}>{resumen.titulo}</Badge>} />

      {/* Indicadores clave: distancia al máximo de 52 semanas (S&P 500, Merval, Oro). */}
      <div className="px-4 pt-3.5">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-500 mb-1.5">Distancia al máximo · 52 semanas</p>
        <div className="grid grid-cols-3 gap-2">
          {DD_ITEMS.map(({ key, label }) => {
            const d = dd[key];
            const pct = d ? distanciaMaximo(d.actual, d.max) : null;
            // Cerca del máximo = caro (warn); caída grande = posible oportunidad (celeste); medio = neutral.
            const cls = pct == null ? 'text-ink-500' : pct > -0.02 ? 'text-warn' : pct < -0.15 ? 'text-celeste-600' : 'text-ink-900';
            return (
              <div key={key} className="rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2.5 min-w-0"
                title={d ? `Actual ${Math.round(d.actual).toLocaleString('en-US')} · máx 52s ${Math.round(d.max).toLocaleString('en-US')}` : undefined}>
                <p className="text-[10px] uppercase text-ink-600 font-semibold truncate">{label}</p>
                <p className={`text-lg font-bold tnum mt-0.5 ${cls}`}>{pct == null ? '—' : pct === 0 ? 'en máx.' : fmtPct(pct, 1)}</p>
                <p className="text-[10px] text-ink-500">vs máx</p>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-ink-500 mt-1.5">Todo en USD · Merval = ^MERV ÷ CCL (con CCL histórico).</p>
      </div>

      {/* Salud del tablero: barra verde/amarillo/rojo + leyenda (visual, de un vistazo). */}
      {total === 0 ? (
        <div className="px-4 pt-3.5"><p className="text-sm text-ink-600">Todavía no hay datos de mercado; se completan con el próximo refresco.</p></div>
      ) : (
        <div className="px-4 pt-3.5">
          <div className="h-2.5 rounded-full bg-canvas overflow-hidden flex">
            {verdes > 0 && <div className="bg-pos" style={{ width: `${pct(verdes)}%` }} />}
            {amarillos > 0 && <div className="bg-warn" style={{ width: `${pct(amarillos)}%` }} />}
            {rojos > 0 && <div className="bg-neg" style={{ width: `${pct(rojos)}%` }} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-ink-600">
            <span className="inline-flex items-center gap-1.5 tnum"><span className="w-2 h-2 rounded-full bg-pos" /> {verdes} en verde</span>
            <span className="inline-flex items-center gap-1.5 tnum"><span className="w-2 h-2 rounded-full bg-warn" /> {amarillos} atención</span>
            <span className="inline-flex items-center gap-1.5 tnum"><span className="w-2 h-2 rounded-full bg-neg" /> {rojos} estrés</span>
          </div>
        </div>
      )}

      {/* Focos de atención: solo las señales que no están en verde (lo accionable). */}
      {resumen.alertas.length > 0 && (
        <div className="px-4 pt-3">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-500 mb-1.5">Focos de atención</p>
          <div className="flex flex-wrap gap-1.5">
            {resumen.alertas.map(a => <Badge key={a.key} tone={TONE_ALERTA[a.luz]}>{a.label}: {a.msg}</Badge>)}
          </div>
        </div>
      )}

      {/* Indicadores agrupados por área (colapsable, para no saturar). */}
      <div className="px-4 pt-3">
        <button onClick={() => setAbierto(v => !v)} className="text-[11px] font-semibold text-celeste-600 hover:underline">
          {abierto ? 'Ocultar indicadores' : `Ver los ${conDatos.length} indicadores`}
        </button>
        {abierto && (
          <div className="mt-2 space-y-2">
            {GRUPOS.map(g => {
              const items = readings.filter(r => r.def.grupo === g.key && r.valor != null);
              if (!items.length) return null;
              return (
                <div key={g.key}>
                  <p className="text-[9px] uppercase tracking-wide text-ink-500 mb-1">{g.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map(({ def, valor, luz }) => (
                      <span key={def.key} className="inline-flex items-center gap-1.5 rounded-full bg-canvas ring-1 ring-inset ring-line px-2.5 py-1 text-[11px]">
                        <span className={`w-1.5 h-1.5 rounded-full ${luz ? LUZ_DOT[luz] : 'bg-ink-300'}`} />
                        <span className="text-ink-600">{def.label}</span>
                        <span className="tnum font-semibold text-ink-900">{def.fmt ? def.fmt(valor!) : valor}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lectura ejecutiva por IA: un solo párrafo. */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" onClick={explicar} disabled={busy || conDatos.length === 0}>
            <Sparkles className="w-4 h-4" /> {busy ? 'Analizando…' : mostrado ? 'Volver a analizar' : 'Lectura ejecutiva (IA)'}
          </Button>
          {err && <span className="text-[11px] text-neg">No se pudo generar: {err}</span>}
        </div>
        {mostrado && (
          <div className="mt-2 rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2.5">
            <p className="text-sm text-ink-800 leading-relaxed whitespace-pre-wrap break-words">{mostrado}</p>
            <p className="text-[10px] text-ink-600 mt-1.5">Lectura por IA · los valores los calcula el código.{!ia && fecha && ` · ${new Date(fecha).toLocaleDateString('es-AR')}`}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
