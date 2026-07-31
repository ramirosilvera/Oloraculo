import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes, useMacro, useDrawdowns } from '../hooks/usePosiciones';
import { useAportes } from '../hooks/useAportes';
import { useFlujo } from '../hooks/useFlujo';
import { useCobros } from '../hooks/useCobros';
import { useBrokers } from '../hooks/useBrokers';
import { usePosicionBrokers } from '../hooks/usePosicionBrokers';
import { useEstadoCuenta, useAdminUsers } from '../hooks/useAdmin';
import { useChartTheme } from '../hooks/usePrefs';
import { SEMAFOROS, resumenMacro, type Lectura, type ResumenMacro } from '../engine/semaforos';
import { resumenFlujo } from '../engine/flujo';
import { resumenCobros } from '../engine/cobros';
import { redondearPct } from '../engine/rebalance';
import { resumenPorBroker } from '../engine/brokers';
import { portfolioTir } from '../engine/irr';
import { rendimientoPorAnio } from '../engine/rendimiento';
import { useSnapshots, useRecordSnapshot } from '../hooks/useSnapshots';
import { Card, CardHeader, Stat, Badge, fmtUsd, fmtUsdCompact, fmtPct, fmtArs, fmtArsCompact, PIE_COLORS, colorDeBroker } from '../components/ui';
import { UpdatedAt } from '../components/UpdatedAt';
import { DistanciaMaximo } from '../components/DistanciaMaximo';
import { unitValueUSD as unitUSD } from '../lib/valuation';
import type { Posicion } from '../types/domain';

export function DashboardPage() {
  const { active } = usePortfolios();
  const qPos = usePosiciones(active?.id);
  const posiciones = qPos.data ?? [];
  const equity = posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const arStocks = posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker);
  const qQuotes = useQuotes(equity, bonds, arStocks);
  const quotes = qQuotes.data ?? {};
  const { data: macro = {} } = useMacro();
  const qAportes = useAportes(active?.id);
  const aportes = qAportes.data ?? [];
  const { data: flujo = [] } = useFlujo();
  const { data: cobros = [] } = useCobros(active?.id);
  const resumenCobrado = useMemo(() => resumenCobros(cobros), [cobros]);
  // Sugeridos por el cron, sin confirmar todavía — resumenCobros los excluye a propósito de los
  // totales (no son plata confirmada), así que se cuentan aparte solo para avisar que hay algo
  // esperando revisión en /cupones.
  const pendientesCount = useMemo(() => cobros.filter(c => c.estado === 'pendiente').length, [cobros]);

  const { patrimonio, costo, pnl, alloc, sinPrecio } = useMemo(() => {
    let patrimonio = 0, costo = 0;
    const parts: { ticker: string; mkt: number; target: number | null }[] = [];
    // Posiciones ABIERTAS con ticker cotizable que quedaron sin precio: se valúan a costo, así que
    // el patrimonio no es "de mercado". Hay que decirlo (y no grabar ese valor en el histórico).
    const sinPrecio: string[] = [];
    for (const p of posiciones) {
      const u = unitUSD(p, quotes[p.ticker] ?? null);
      const mkt = u != null ? u * p.cantidad : p.precio_compra * p.cantidad;
      if (u == null && p.cantidad > 0 && p.tipo !== 'cash') sinPrecio.push(p.ticker);
      patrimonio += mkt;
      costo += p.precio_compra * p.cantidad;
      if (mkt > 0) parts.push({ ticker: p.ticker, mkt, target: p.peso_objetivo });
    }
    parts.sort((a, b) => b.mkt - a.mkt);
    return { patrimonio, costo, pnl: patrimonio - costo, alloc: parts, sinPrecio };
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

  // ── Rendimiento por año calendario (a partir de snapshots diarios del valor) ──
  const hoy = new Date().toISOString().slice(0, 10);
  const anioActual = Number(hoy.slice(0, 10).slice(0, 4));
  // Capital aportado neto: aportes (aportes − retiros) si están cargados; si no, el costo de las
  // posiciones (mismo criterio que portfolioTir) para que el rendimiento se pueda calcular igual.
  const aportadoNeto = aportes.length
    ? aportes.reduce((s, a) => s + (a.tipo === 'retiro' ? -a.monto : a.monto), 0)
    : costo;
  const qSnaps = useSnapshots(active?.id);
  const snaps = qSnaps.data ?? [];
  const record = useRecordSnapshot();
  const recordedRef = useRef('');

  // El snapshot solo es fiable cuando TODO resolvió: si se graba antes de que lleguen las
  // cotizaciones, el patrimonio cae a costo; y si se graba antes que los aportes, `aportadoNeto`
  // usa el fallback de costo. Cualquiera de las dos cosas ensucia el histórico de rendimiento.
  const sinTickers = equity.length + bonds.length + arStocks.length === 0;
  const datosListos = qPos.isSuccess && qAportes.isSuccess && qSnaps.isSuccess
    && (sinTickers || (qQuotes.isSuccess && !qQuotes.isFetching))
    // Clave: isSuccess es true aunque la respuesta venga VACÍA (allSettled). Si alguna posición
    // quedó sin precio, el patrimonio es costo disfrazado de mercado: no se graba el snapshot.
    && sinPrecio.length === 0;

  // Año de creación real (primer aporte o primera compra), para no atribuir mal el rendimiento.
  const inceptionYear = useMemo(() => {
    const fechas = [
      ...aportes.map(a => a.fecha),
      ...posiciones.map(p => p.fecha_compra).filter((f): f is string => !!f),
    ].filter(f => f && !Number.isNaN(Date.parse(f))).sort();
    return fechas.length ? Number(fechas[0].slice(0, 4)) : anioActual;
  }, [aportes, posiciones, anioActual]);

  // Serie de puntos = snapshots históricos + el valor de HOY en vivo (fresco).
  const porAnio = useMemo(() => {
    const puntos = [...snaps.filter(s => s.fecha !== hoy), { fecha: hoy, valor: patrimonio, aportado: aportadoNeto }];
    // Flujos fechados → el rendimiento del año usa Modified Dietz (pondera por tiempo invertido),
    // así un aporte grande a fin de año no distorsiona el %.
    const flujos = aportes
      .filter(a => a.fecha && !Number.isNaN(Date.parse(a.fecha)))
      .map(a => ({ fecha: a.fecha, monto: a.tipo === 'retiro' ? -a.monto : a.monto }));
    return rendimientoPorAnio(puntos, inceptionYear, hoy, flujos);
  }, [snaps, hoy, patrimonio, aportadoNeto, inceptionYear, aportes]);
  const rendActual = porAnio.find(r => r.anio === anioActual)?.rendimiento ?? null;

  // Registra el snapshot de hoy (idempotente por día). El lock incluye el valor grabado, así que si
  // el patrimonio se corrige (llegan cotizaciones frescas) el snapshot del día se actualiza en vez
  // de quedar clavado en un valor provisorio.
  useEffect(() => {
    if (!active?.id || !datosListos || !(patrimonio > 0)) return;
    const key = `${active.id}:${hoy}:${Math.round(patrimonio)}:${Math.round(aportadoNeto)}`;
    if (recordedRef.current === key) return;
    const hoySnap = snaps.find(s => s.fecha === hoy);
    const cambió = !hoySnap
      || Math.abs(hoySnap.valor - patrimonio) / Math.max(1, patrimonio) > 0.005
      || Math.abs(hoySnap.aportado - aportadoNeto) > 0.01;
    if (cambió) {
      recordedRef.current = key;
      void record(active.id, hoy, patrimonio, aportadoNeto).catch(() => { recordedRef.current = ''; });
    }
  }, [active?.id, datosListos, patrimonio, aportadoNeto, snaps, hoy, record]);

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Dashboard · {active.nombre}</h1>
        <UpdatedAt icon />
      </div>

      {sinPrecio.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-warn/10 ring-1 ring-inset ring-warn/25 px-3 py-2.5 text-[11px] text-ink-700">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warn mt-0.5" />
          <p>
            Sin cotización de <b>{sinPrecio.slice(0, 4).join(', ')}{sinPrecio.length > 4 ? ` +${sinPrecio.length - 4}` : ''}</b>:
            esas posiciones se muestran <b>a costo</b>, así que el patrimonio y el P&L no reflejan el mercado.
            No se registra el histórico del día hasta que vuelvan los precios.
          </p>
        </div>
      )}

      {/* Hero: lo esencial, sin repetir. Patrimonio con más peso visual — es el número más
          decisivo de la página — el resto queda como Stat normal debajo. */}
      <div className="space-y-2">
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-5 py-4" title={`costo ${fmtUsdCompact(costo)}`}>
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold">Patrimonio</p>
          <p className="text-3xl font-bold text-ink-900 tnum mt-1 font-display">{fmtUsdCompact(patrimonio)}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="P&L" value={<span className={pnl >= 0 ? 'text-pos' : 'text-neg'}>{fmtUsdCompact(pnl)}</span>} delta={costo > 0 ? pnl / costo : undefined} />
          <Stat label="Rend. total"
            value={<span className={tir.historica == null ? '' : tir.historica >= 0 ? 'text-pos' : 'text-neg'}>{tir.historica != null ? fmtPct(tir.historica) : '—'}</span>}
            hint={`rendimiento acumulado desde la creación${tir.aproximada ? ' (aprox., sin aportes cargados)' : ''}`} />
          <Stat label={`Rend. ${anioActual}`}
            value={<span className={rendActual == null ? '' : rendActual >= 0 ? 'text-pos' : 'text-neg'}>{rendActual != null ? fmtPct(rendActual) : '—'}</span>}
            hint={`rendimiento del año en curso${inceptionYear === anioActual ? ' (nació este año)' : ''}`} />
        </div>
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

      {/* Rendimiento por año calendario (estilo fondo). */}
      {tir.base !== 'sin-datos' && (
        <Card>
          <CardHeader title="Rendimiento por año" sub="Cuánto rindió cada año calendario (del pasado, no anualizado)." />
          <div className="p-4 flex flex-wrap gap-2">
            {[...porAnio].reverse().map(({ anio, rendimiento }) => (
              <div key={anio} className="rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2 min-w-[88px]">
                <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold">{anio}{anio === anioActual ? ' · en curso' : ''}</p>
                <p className={`text-lg font-bold tnum mt-0.5 ${rendimiento == null ? 'text-ink-500' : rendimiento >= 0 ? 'text-pos' : 'text-neg'}`}>
                  {rendimiento != null ? fmtPct(rendimiento) : '—'}
                </p>
              </div>
            ))}
          </div>
          {porAnio.some(r => r.rendimiento == null) && (
            <p className="px-4 pb-3 text-[11px] text-ink-500">Los años en "—" se completan a medida que la app registra el valor diario; el histórico previo a esta función no se puede reconstruir.</p>
          )}
        </Card>
      )}

      {/* Distribución: donut + actual vs objetivo. */}
      <Distribucion alloc={alloc} total={patrimonio} isLoading={qPos.isLoading} />

      {/* Patrimonio por broker: dónde está físicamente cada posición. */}
      <PatrimonioBrokers posiciones={posiciones} quotes={quotes} isLoading={qPos.isLoading} />

      {cobros.length > 0 && <CobrosResumen resumen={resumenCobrado} pendientesCount={pendientesCount} />}

      {flujo.length > 0 && <LiquidezFci resumen={flujoR} mep={mep} />}

      <MacroResumen resumen={resumen} />

      <AdminResumen />
    </div>
  );
}

// Resumen mínimo de administración, solo para admins (no dispara el fetch de /api/admin/users
// hasta confirmar isAdmin — ver useAdminUsers). La gestión completa vive en /admin; acá es solo
// un vistazo rápido de cuántos usuarios hay y cuántos esperan aprobación.
function AdminResumen() {
  const { isAdmin, isLoading: chequeandoAdmin } = useEstadoCuenta();
  const { users, isLoading } = useAdminUsers(isAdmin);
  if (chequeandoAdmin || !isAdmin) return null;
  const pendientes = users.filter(u => !u.isApproved).length;

  return (
    <Card>
      <CardHeader title="Administración" sub="Resumen rápido de usuarios."
        right={pendientes > 0
          ? <Link to="/admin" className="inline-flex items-center gap-1.5"><Badge tone="warn">{pendientes} pendiente{pendientes > 1 ? 's' : ''}</Badge></Link>
          : <Link to="/admin" className="text-[11px] text-celeste-600 hover:underline">Ir a Admin →</Link>} />
      <div className="grid grid-cols-2 gap-2 p-3">
        <Stat label="Usuarios" value={isLoading ? '—' : users.length} />
        <Stat label="Pendientes de aprobación" value={isLoading ? '—' : pendientes} />
      </div>
    </Card>
  );
}

function Distribucion({ alloc, total, isLoading }: { alloc: { ticker: string; mkt: number; target: number | null }[]; total: number; isLoading: boolean }) {
  const chart = useChartTheme();
  if (isLoading) {
    return <Card><CardHeader title="Distribución" /><p className="p-4 text-sm text-ink-600">Cargando…</p></Card>;
  }
  if (alloc.length === 0) {
    return <Card><CardHeader title="Distribución" /><p className="p-4 text-sm text-ink-600">Sin posiciones. Cargalas en Posiciones.</p></Card>;
  }
  const data = alloc.map(a => ({ name: a.ticker, value: a.mkt }));
  // % objetivo mostrados como enteros que suman 100 (resto mayor), coherente con Posiciones.
  const objPct = redondearPct(alloc.filter(a => a.target != null).map(a => ({ id: a.ticker, peso: a.target! })));
  // Mismo umbral que usa cada fila para decidir si mostrar la desviación (más abajo) — resumen
  // agregado al estilo "Focos de atención" de MacroContext, para que el drift no pase desapercibido.
  const desviados = alloc.filter(a => {
    if (a.target == null) return false;
    const w = total > 0 ? a.mkt / total : 0;
    return Math.abs(w - a.target) >= 0.005;
  }).length;
  return (
    <Card>
      <CardHeader title="Distribución" sub="Peso de cada activo · actual vs objetivo."
        right={desviados > 0 ? <Badge tone="warn">{desviados} fuera del objetivo</Badge> : undefined} />
      <div className="p-4 grid sm:grid-cols-[minmax(0,200px)_1fr] gap-4 items-center">
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={2} stroke="none">
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
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
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
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

// Cobros reales (dividendos + intereses + amortizaciones) — cuánto entró y cuánto está sin
// reinvertir todavía. La amortización se ve reflejada en "Cobrado total" (es plata real) pero no en
// "Renta" (es devolución de capital, no ganancia).
function CobrosResumen({ resumen, pendientesCount }: { resumen: ReturnType<typeof resumenCobros>; pendientesCount: number }) {
  return (
    <Card>
      <CardHeader title="Cobros" sub="Dividendos, intereses y amortizaciones efectivamente cobrados."
        right={pendientesCount > 0
          ? <Link to="/cupones" className="inline-flex items-center gap-1.5"><Badge tone="warn">{pendientesCount} por confirmar</Badge></Link>
          : <Link to="/cupones" className="text-[11px] text-celeste-600 hover:underline">Ver detalle →</Link>} />
      <div className="grid grid-cols-3 gap-2 p-3">
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-3 py-3 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">Cobrado total</p>
          <p className="text-lg font-bold font-display tnum mt-1 truncate text-ink-900">{fmtUsdCompact(resumen.total)}</p>
          <p className="text-[10px] text-ink-500 mt-0.5 truncate">dividendos + intereses + amort.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-3 py-3 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">Disponible</p>
          <p className={`text-lg font-bold font-display tnum mt-1 truncate ${resumen.disponible > 0 ? 'text-warn' : 'text-ink-900'}`}>{fmtUsdCompact(resumen.disponible)}</p>
          <p className="text-[10px] text-ink-500 mt-0.5 truncate">listo para reinvertir</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-3 py-3 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">Renta pura</p>
          <p className="text-lg font-bold font-display tnum mt-1 truncate text-ink-900">{fmtUsdCompact(resumen.porTipo.dividendo + resumen.porTipo.interes)}</p>
          <p className="text-[10px] text-ink-500 mt-0.5 truncate">sin contar amortización</p>
        </div>
      </div>
    </Card>
  );
}

// Liquidez & FCI: la parte del flujo de caja que se muestra en el Dashboard (near-cash sleeve).
// Montos en pesos formateados compactos ($22,9 M) para que no desborden las cajas; el valor exacto
// queda en el tooltip.
function LiquidezFci({ resumen, mep }: { resumen: ReturnType<typeof resumenFlujo>; mep: number | null }) {
  const usd = (ars: number) => (mep ? `≈ ${fmtUsd(ars / mep, 0)}` : 'liquidez');
  const tiles = [
    { label: 'FCI + billetera', val: resumen.fci, sub: usd(resumen.fci), tone: 'text-ink-900' },
    { label: 'Disponible', val: resumen.disponible, sub: 'ingresos − egresos', tone: resumen.disponible >= 0 ? 'text-pos' : 'text-neg' },
    { label: 'Sin asignar', val: resumen.sinAsignar, sub: 'sin colocar', tone: resumen.sinAsignar >= 0 ? 'text-ink-900' : 'text-neg' },
  ];
  return (
    <Card>
      <CardHeader title="Liquidez & FCI" sub="Fondos y billetera en pesos, según tu flujo de caja · compartido entre todos tus portfolios."
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

// Patrimonio por broker: mismo cálculo y donut que BrokersPage, resumido para el Dashboard.
function PatrimonioBrokers({ posiciones, quotes, isLoading }: {
  posiciones: Posicion[]; quotes: Record<string, number | null>; isLoading: boolean;
}) {
  const chart = useChartTheme();
  const { data: brokers = [], isLoading: brokersLoading } = useBrokers();
  const { data: asignacionesAll = [], isLoading: asigLoading } = usePosicionBrokers();

  const abiertas = useMemo(() => posiciones.filter(p => p.cantidad > 0), [posiciones]);
  // Mismo criterio de valuación que Posiciones/Brokers (unitUSD, fallback a costo sin cotización).
  const posValuadas = useMemo(() => abiertas.map(p => {
    const unit = unitUSD(p, quotes[p.ticker] ?? null);
    const valorUsd = unit != null ? unit * p.cantidad : p.precio_compra * p.cantidad;
    return { id: p.id, cantidad: p.cantidad, valorUsd };
  }), [abiertas, quotes]);
  const asignaciones = useMemo(() => {
    const ids = new Set(abiertas.map(p => p.id));
    return asignacionesAll.filter(a => ids.has(a.posicion_id))
      .map(a => ({ posicionId: a.posicion_id, brokerId: a.broker_id, cantidad: a.cantidad }));
  }, [asignacionesAll, abiertas]);
  const resumen = useMemo(() => resumenPorBroker(posValuadas, asignaciones, brokers), [posValuadas, asignaciones, brokers]);

  const cargando = isLoading || brokersLoading || asigLoading;
  const right = <Link to="/brokers" className="text-[11px] text-celeste-600 hover:underline">Ver detalle →</Link>;
  if (cargando) {
    return <Card><CardHeader title="Patrimonio por broker" right={right} /><p className="p-4 text-sm text-ink-600">Cargando…</p></Card>;
  }
  if (resumen.length === 0) {
    return <Card><CardHeader title="Patrimonio por broker" right={right} /><p className="p-4 text-sm text-ink-600">Sin posiciones. Cargalas en Posiciones.</p></Card>;
  }
  return (
    <Card>
      <CardHeader title="Patrimonio por broker" sub="Dónde está físicamente cada posición." right={right} />
      <div className="p-4 grid sm:grid-cols-[minmax(0,180px)_1fr] gap-4 items-center">
        <div className="h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={resumen} dataKey="valorUsd" nameKey="nombre" cx="50%" cy="50%" innerRadius={42} outerRadius={72} paddingAngle={2} stroke="none">
                {resumen.map((r, i) => <Cell key={r.brokerId ?? 'sin-asignar'} fill={colorDeBroker(i, r.brokerId)} />)}
              </Pie>
              <Tooltip
                formatter={(v: number) => [fmtUsdCompact(v), 'Patrimonio']}
                contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1">
          {resumen.map((r, i) => (
            <div key={r.brokerId ?? 'sin-asignar'} className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorDeBroker(i, r.brokerId) }} />
              <span className={`font-semibold flex-1 min-w-0 truncate ${r.brokerId == null ? 'text-ink-500' : 'text-ink-800'}`}>{r.nombre}</span>
              <span className="tnum text-ink-600 w-16 text-right">{fmtPct(r.pct, 0)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Contexto macro resumido: título + distancia a máximos + barra de salud. El detalle completo
// (focos de atención, indicadores agrupados, lectura ejecutiva por IA) vive en /macro — acá solo
// el vistazo rápido, con un link al detalle.
function MacroResumen({ resumen }: { resumen: ResumenMacro }) {
  const { data: dd = {} } = useDrawdowns();
  const tone = resumen.luz === 'rojo' ? 'neg' : resumen.luz === 'amarillo' ? 'warn' : 'pos';
  const { verdes, amarillos, rojos, total } = resumen.conteo;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <Card>
      <CardHeader title="Contexto macro" sub="Semáforos de mercado, de un vistazo."
        right={<Badge tone={tone}>{resumen.titulo}</Badge>} />

      <DistanciaMaximo dd={dd} />

      {/* Salud del tablero: barra verde/amarillo/rojo + leyenda (visual, de un vistazo). */}
      {total === 0 ? (
        <div className="px-4 pt-3.5 pb-4"><p className="text-sm text-ink-600">Todavía no hay datos de mercado; se completan con el próximo refresco.</p></div>
      ) : (
        <div className="px-4 pt-3.5 pb-4">
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

      <div className="px-4 pb-3.5 pt-1 border-t border-line">
        <Link to="/macro" className="text-[11px] text-celeste-600 hover:underline">Ver contexto macro completo →</Link>
      </div>
    </Card>
  );
}
