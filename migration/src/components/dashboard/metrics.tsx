// Tarjetas atómicas del Dashboard personalizable — una por MetricKey (engine/dashboardCatalog.ts).
// Cada una es un componente chico y AUTOCONTENIDO que llama exactamente el mismo hook/engine que ya
// usa la sección equivalente (CedearsResumen, BonosResumen, etc. en DashboardPage.tsx) — regla de
// oro #1: nunca un cálculo nuevo o distinto. React Query dedupea por query key, así que si el usuario
// agrega varias tarjetas de la misma familia (ej. 2 métricas de CEDEARs), el hook subyacente
// (useCedearsCalc) se pide una sola vez igual — no hace falta un store central para evitar refetching.
//
// Cada componente recibe `viz` (la visualización elegida por el usuario para ESA tarjeta) y decide
// con qué renderer pintar su MetricValue — el cálculo del valor y la elección de visualización son
// cosas separadas a propósito (misma métrica, varias vistas posibles).
//
// `ctx` es SOLO para las 2 métricas de "Cartera" (distribución), que no tienen un hook propio — usan
// `alloc`/`patrimonio` ya calculados por el componente principal del Dashboard (mismo dato que el
// Hero y la sección Distribución), pasados por prop para no duplicar ni tocar ese cálculo sensible
// (alimenta el registro histórico de rendimiento — ver DashboardPage.tsx).
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { usePortfolios } from '../../hooks/usePortfolios';
import { useMacro } from '../../hooks/usePosiciones';
import { useChartTheme } from '../../hooks/usePrefs';
import { useCedearsCalc, resumenCedears } from '../../hooks/useCedears';
import { SIN_CLASIFICAR_COLOR } from '../../engine/cedears';
import { PIE_COLORS } from '../ui';
import { useBonosCalc, resumenBonos } from '../../hooks/useBonos';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useCikMap } from '../../hooks/useCikMap';
import { useDcfInputs, type StoredDcf } from '../../hooks/useDcfInputs';
import { useRadarTicker } from '../../hooks/useRadarTicker';
import { useCobros } from '../../hooks/useCobros';
import { useFlujo } from '../../hooks/useFlujo';
import { useAmortizaciones } from '../../hooks/useAmortizaciones';
import { resumenCobros } from '../../engine/cobros';
import { resumenFlujo } from '../../engine/flujo';
import { SEMAFOROS, resumenMacro, type Lectura } from '../../engine/semaforos';
import { agruparPorCategoria, agruparPorTipo } from '../../engine/distribucion';
import { capitalCalendar, agruparCuotasPorPosicion, type CapitalBond } from '../../engine/coupons';
import { LoadingViz, EmptyViz, StatViz, DonutViz, BarViz, TableViz } from './viz';
import type { MetricValue } from '../../engine/dashboardCatalog';
import type { AssetType, DashboardViz, MetricKey } from '../../types/domain';

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export interface MetricContext {
  alloc: { ticker: string; mkt: number; target: number | null; tipo: AssetType }[];
  patrimonio: number;
  isLoading: boolean;
}

export type MetricComponent = ComponentType<{ ctx: MetricContext; viz: DashboardViz }>;

// Pinta un MetricValue con el renderer que corresponda a `viz` — separa "qué número es" (calculado
// arriba, siempre igual) de "cómo se ve" (elegido por el usuario al armar la tarjeta).
function Render({ mv, viz }: { mv: MetricValue; viz: DashboardViz }) {
  if (mv.status === 'loading') return <LoadingViz />;
  if (mv.status === 'empty') return <EmptyViz motivo={mv.motivo} />;
  if (mv.shape === 'scalar') return <StatViz mv={mv} />;
  // shape === 'categorico'
  if (viz === 'bar') return <BarViz mv={mv} />;
  if (viz === 'table') return <TableViz mv={mv} />;
  return <DonutViz mv={mv} />;
}

// ── Cartera (usan ctx, no hooks propios) ───────────────────────────────────────
function DistribucionCategoriaMetric({ ctx, viz }: { ctx: MetricContext; viz: DashboardViz }) {
  const grupos = agruparPorCategoria(ctx.alloc);
  const mv: MetricValue = ctx.isLoading ? { status: 'loading' }
    : grupos.length === 0 ? { status: 'empty', motivo: 'Sin posiciones valuadas todavía.' }
    : { status: 'ok', shape: 'categorico', format: 'usd-compact', items: grupos.map(g => ({ label: g.label, value: g.value, color: g.color })) };
  return <Render mv={mv} viz={viz} />;
}

function DistribucionTipoActivoMetric({ ctx, viz }: { ctx: MetricContext; viz: DashboardViz }) {
  const grupos = agruparPorTipo(ctx.alloc);
  const mv: MetricValue = ctx.isLoading ? { status: 'loading' }
    : grupos.length === 0 ? { status: 'empty', motivo: 'Sin posiciones valuadas todavía.' }
    : { status: 'ok', shape: 'categorico', format: 'usd-compact', items: grupos.map(g => ({ label: g.label, value: g.value, color: g.color })) };
  return <Render mv={mv} viz={viz} />;
}

// ── CEDEARs (useCedearsCalc, igual que CedearsResumen/CedearsPage) ────────────
function useCedearsResumenValue() {
  const { active } = usePortfolios();
  const { cedears, cedearsCalc, isLoading } = useCedearsCalc(active?.id);
  return { cedears, resumen: isLoading || cedears.length === 0 ? null : resumenCedears(cedearsCalc), isLoading };
}

function CedearsCapitalMetric({ viz }: { viz: DashboardViz }) {
  const { resumen, isLoading } = useCedearsResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen ? { status: 'empty', motivo: 'Sin CEDEARs en este portfolio.' }
    : { status: 'ok', shape: 'scalar', value: resumen.totalMkt, format: 'usd-compact' };
  return <Render mv={mv} viz={viz} />;
}

function CedearsMayorPosicionMetric({ viz }: { viz: DashboardViz }) {
  const { resumen, isLoading } = useCedearsResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen || !resumen.mayorPosicion ? { status: 'empty', motivo: 'Sin CEDEARs en este portfolio.' }
    : { status: 'ok', shape: 'scalar', value: resumen.mayorPosicion.pct, format: 'pct', label: `${resumen.mayorPosicion.ticker} · ${(resumen.mayorPosicion.pct * 100).toFixed(0)}%` };
  return <Render mv={mv} viz={viz} />;
}

function CedearsPorSectorMetric({ viz }: { viz: DashboardViz }) {
  const { resumen, isLoading } = useCedearsResumenValue();
  // Mismo criterio de color que CedearsPage.tsx: "Sin sector" en gris neutro (no compite por un
  // color de PIE_COLORS como si fuera un sector real), los sectores reales ciclan PIE_COLORS con su
  // propio contador — así el mismo dato se ve con los mismos colores acá y en /cedears.
  let sectorRealIdx = 0;
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen || resumen.porSector.length === 0 ? { status: 'empty', motivo: 'Sin CEDEARs en este portfolio.' }
    : {
        status: 'ok', shape: 'categorico', format: 'usd-compact',
        items: resumen.porSector.map(s => ({
          label: s.sector, value: s.pct * resumen.totalMkt,
          color: s.sector === 'Sin sector' ? SIN_CLASIFICAR_COLOR : PIE_COLORS[sectorRealIdx++ % PIE_COLORS.length],
        })),
      };
  return <Render mv={mv} viz={viz} />;
}

// ── Bonos (useBonosCalc, igual que BonosResumen/BonosPage) ────────────────────
function useBonosResumenValue() {
  const { active } = usePortfolios();
  const { bonos, bonosCalc, isLoading } = useBonosCalc(active?.id);
  const { data: macro = {} } = useMacro();
  const riskFree = (macro as Record<string, number | null>).dgs10 != null ? (macro as Record<string, number | null>).dgs10! / 100 : null;
  return { bonos, resumen: isLoading || bonos.length === 0 ? null : resumenBonos(bonosCalc, riskFree), isLoading };
}

function BonosCapitalMetric({ viz }: { viz: DashboardViz }) {
  const { resumen, isLoading } = useBonosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen ? { status: 'empty', motivo: 'Sin bonos en este portfolio.' }
    : { status: 'ok', shape: 'scalar', value: resumen.totalMkt, format: 'usd-compact' };
  return <Render mv={mv} viz={viz} />;
}

function BonosTirPromedioMetric({ viz }: { viz: DashboardViz }) {
  const { resumen, isLoading } = useBonosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen || resumen.tirPromedio == null ? { status: 'empty', motivo: 'Sin TIR calculable (faltan datos de cupón/vencimiento).' }
    : { status: 'ok', shape: 'scalar', value: resumen.tirPromedio, format: 'pct', tone: resumen.tirPromedio >= 0 ? 'pos' : 'neg' };
  return <Render mv={mv} viz={viz} />;
}

function BonosDuracionPromedioMetric({ viz }: { viz: DashboardViz }) {
  const { resumen, isLoading } = useBonosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen || resumen.duracionPromedio == null ? { status: 'empty', motivo: 'Sin duración calculable (faltan datos de cupón/vencimiento).' }
    // dp:1 — mismo redondeo que BonosResumen (fmtNum(duracionPromedio, 1)), para no mostrar "6.30"
    // acá y "6.3a" en la sección del mismo dato.
    : { status: 'ok', shape: 'scalar', value: resumen.duracionPromedio, format: 'num', dp: 1, sub: 'años (Macaulay, ponderado)' };
  return <Render mv={mv} viz={viz} />;
}

function BonosGradoInversionMetric({ viz }: { viz: DashboardViz }) {
  const { resumen, isLoading } = useBonosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen ? { status: 'empty', motivo: 'Sin bonos en este portfolio.' }
    // dp:0 — mismo redondeo que BonosResumen (fmtPct(x, 0)).
    : { status: 'ok', shape: 'scalar', value: resumen.distribucionGrado.gradoInversion, format: 'pct', dp: 0 };
  return <Render mv={mv} viz={viz} />;
}

// Mismo cálculo EXACTO que `proximoCapital` en DashboardPage.tsx (capitalCalendar sobre
// amortizaciones_programadas, filtrando cuotas ya cobradas) — reusado acá para que esta tarjeta
// atómica también muestre un número real, no solo un remito a la tarjeta Cobros.
function useBonosProximoCapitalValue() {
  const { active } = usePortfolios();
  const { bonos, isLoading: bonosLoading } = useBonosCalc(active?.id);
  const { data: amortizaciones = [], isLoading: amortLoading } = useAmortizaciones();
  const cuotasPorPosicion = useMemo(() => agruparCuotasPorPosicion(amortizaciones), [amortizaciones]);
  const hoy = new Date();
  const hoyISO = hoy.toISOString().slice(0, 10);
  const proximoCapital = useMemo(() => {
    const capitalBonds: CapitalBond[] = bonos.map(p => ({
      ticker: p.ticker, faceValue: p.cantidad, vencimiento: p.vencimiento,
      valorResidual: p.amortizable && p.valor_residual != null ? p.valor_residual : 1,
      amortizaciones: (cuotasPorPosicion.get(p.id) ?? []).filter(c => c.fecha >= hoyISO),
    }));
    if (capitalBonds.length === 0) return null;
    return capitalCalendar(capitalBonds, hoy.getFullYear(), hoy.getMonth() + 1, 12).find(m => m.total > 0) ?? null;
  }, [bonos, cuotasPorPosicion, hoyISO, hoy.getFullYear(), hoy.getMonth()]);
  return { bonos, proximoCapital, isLoading: bonosLoading || amortLoading };
}

function BonosProximoCapitalMetric({ viz }: { viz: DashboardViz }) {
  const { bonos, proximoCapital, isLoading } = useBonosProximoCapitalValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : bonos.length === 0 ? { status: 'empty', motivo: 'Sin bonos en este portfolio.' }
    : !proximoCapital ? { status: 'empty', motivo: 'Sin capital proyectado en los próximos 12 meses.' }
    : {
        status: 'ok', shape: 'scalar', value: proximoCapital.total, format: 'usd-compact',
        sub: `${MESES_CORTOS[proximoCapital.month - 1]} ${proximoCapital.year} — amortización o rescate, no es renta`,
      };
  return <Render mv={mv} viz={viz} />;
}

// ── Radar (useWatchlist + useRadarTicker por probe, igual que RadarResumen) ───
function useRadarCompraAgresivaValue() {
  const { data: items = [], isLoading } = useWatchlist();
  const { map: cikMap, isLoading: cikLoading } = useCikMap();
  const { data: macro = {} } = useMacro();
  const riskFree = ((macro as Record<string, number | null>).dgs10 ?? 4.3) / 100;
  const { map: dcfMap } = useDcfInputs();
  const [agresivos, setAgresivos] = useState<Set<string>>(new Set());
  // Tickers que YA reportaron al menos una vez (sea agresivo o no) — separado de `agresivos` para
  // poder distinguir "todavía calculando" de "el resultado es 0 compras agresivas". Sin esto, la
  // tarjeta mostraba "0 de N" mientras cada probe (fundamentals/DCF, varios segundos en frío) seguía
  // resolviendo — un 0 provisorio indistinguible del resultado real, justo lo que este mismo archivo
  // documenta evitar (ver el comentario de `status` en engine/dashboardCatalog.ts).
  const [reportados, setReportados] = useState<Set<string>>(new Set());

  const onProbe = useCallback((ticker: string, agresiva: boolean) => {
    setAgresivos(prev => {
      if (prev.has(ticker) === agresiva) return prev;
      const next = new Set(prev);
      if (agresiva) next.add(ticker); else next.delete(ticker);
      return next;
    });
    setReportados(prev => (prev.has(ticker) ? prev : new Set(prev).add(ticker)));
  }, []);

  const probesListos = items.length === 0 || items.every(it => reportados.has(it.ticker.toUpperCase()));
  return { items, cikMap, cikLoading, riskFree, dcfMap, agresivos, onProbe, isLoading: isLoading || !probesListos };
}

function RadarCompraAgresivaMetric({ viz }: { viz: DashboardViz }) {
  const { items, cikMap, cikLoading, riskFree, dcfMap, agresivos, onProbe, isLoading } = useRadarCompraAgresivaValue();
  const mv: MetricValue = items.length === 0 && !isLoading ? { status: 'empty', motivo: 'Sin tickers en seguimiento — agregalos en /radar.' }
    : isLoading ? { status: 'loading' }
    : { status: 'ok', shape: 'scalar', value: agresivos.size, format: 'int', sub: `de ${items.length} en seguimiento` };
  return (
    <>
      {items.map(it => {
        const T = it.ticker.toUpperCase();
        return <RadarProbe key={it.id} ticker={T} cik={it.cik || cikMap.get(T)?.cik} cikLoading={cikLoading}
          riskFree={riskFree} saved={dcfMap.get(T)} onResult={onProbe} />;
      })}
      <Render mv={mv} viz={viz} />
    </>
  );
}

function RadarProbe({ ticker, cik, cikLoading, riskFree, saved, onResult }: {
  ticker: string; cik: string | undefined; cikLoading: boolean; riskFree: number;
  saved: StoredDcf | undefined;
  onResult: (ticker: string, agresiva: boolean) => void;
}) {
  const { agresiva } = useRadarTicker(ticker, cik, cikLoading, riskFree, saved);
  useEffect(() => { onResult(ticker, agresiva); }, [ticker, agresiva, onResult]);
  useEffect(() => () => onResult(ticker, false), [ticker, onResult]);
  return null;
}

// ── Cobros (resumenCobros, igual que CobrosResumen/Cupones) ───────────────────
function useCobrosResumenValue() {
  const { active } = usePortfolios();
  const { data: cobros = [], isLoading } = useCobros(active?.id);
  return { resumen: resumenCobros(cobros), tieneCobros: cobros.length > 0, isLoading };
}

function CobrosTotalMetric({ viz }: { viz: DashboardViz }) {
  const { resumen, tieneCobros, isLoading } = useCobrosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !tieneCobros ? { status: 'empty', motivo: 'Sin cobros registrados todavía.' }
    : { status: 'ok', shape: 'scalar', value: resumen.total, format: 'usd-compact' };
  return <Render mv={mv} viz={viz} />;
}

function CobrosDisponibleMetric({ viz }: { viz: DashboardViz }) {
  const { resumen, tieneCobros, isLoading } = useCobrosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !tieneCobros ? { status: 'empty', motivo: 'Sin cobros registrados todavía.' }
    : { status: 'ok', shape: 'scalar', value: resumen.disponible, format: 'usd-compact', tone: resumen.disponible > 0 ? 'warn' : 'neutral' };
  return <Render mv={mv} viz={viz} />;
}

// ── Macro (SEMAFOROS + resumenMacro, igual que MacroResumen/MacroPage) ────────
function MacroSemaforosMetric({ viz }: { viz: DashboardViz }) {
  const { data: macro = {}, isLoading } = useMacro();
  // Mismos hex que --pos/--warn/--neg por tema (useChartTheme, no un color de paleta categórica que
  // por casualidad se le parece) — así el semáforo se ve igual acá que en /macro y en cualquier
  // badge/texto de estado del resto de la app, y respeta el tema oscuro (recharts no puede resolver
  // `rgb(var(--pos))` en un fill SVG).
  const chart = useChartTheme();
  const semaforos: Lectura[] = SEMAFOROS.map(s => {
    const v = (macro as Record<string, number | null>)[s.key];
    return { def: s, valor: v ?? null, luz: v != null ? s.evalua(v) : null };
  });
  const { conteo } = resumenMacro(semaforos);
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : conteo.total === 0 ? { status: 'empty', motivo: 'Sin datos de mercado todavía.' }
    : {
        status: 'ok', shape: 'categorico', format: 'int', items: [
          { label: 'En verde', value: conteo.verdes, color: chart.pos },
          { label: 'Atención', value: conteo.amarillos, color: chart.warn },
          { label: 'Estrés', value: conteo.rojos, color: chart.neg },
        ].filter(i => i.value > 0),
      };
  return <Render mv={mv} viz={viz} />;
}

// ── Liquidez (resumenFlujo, igual que LiquidezFci/finanzas) ───────────────────
function LiquidezFciMetric({ viz }: { viz: DashboardViz }) {
  const { data: flujo = [], isLoading } = useFlujo();
  const { data: macro = {} } = useMacro();
  const mep = (macro as Record<string, number | null>).dolar_mep ?? (macro as Record<string, number | null>).dolar_ccl ?? null;
  const { fci } = resumenFlujo(flujo, mep);
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : flujo.length === 0 ? { status: 'empty', motivo: 'Sin flujo de caja cargado — cargalo en /finanzas.' }
    : { status: 'ok', shape: 'scalar', value: fci, format: 'ars-compact', sub: mep ? `≈ US$${(fci / mep).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : undefined };
  return <Render mv={mv} viz={viz} />;
}

// ── Registro: MetricKey -> componente ──────────────────────────────────────────
export const METRIC_COMPONENTS: Partial<Record<MetricKey, MetricComponent>> = {
  distribucion_categoria: DistribucionCategoriaMetric,
  distribucion_tipo_activo: DistribucionTipoActivoMetric,
  cedears_capital: CedearsCapitalMetric,
  cedears_mayor_posicion: CedearsMayorPosicionMetric,
  cedears_por_sector: CedearsPorSectorMetric,
  bonos_capital: BonosCapitalMetric,
  bonos_tir_promedio: BonosTirPromedioMetric,
  bonos_duracion_promedio: BonosDuracionPromedioMetric,
  bonos_grado_inversion: BonosGradoInversionMetric,
  bonos_proximo_capital: BonosProximoCapitalMetric,
  radar_compra_agresiva: RadarCompraAgresivaMetric,
  cobros_total: CobrosTotalMetric,
  cobros_disponible: CobrosDisponibleMetric,
  macro_semaforos: MacroSemaforosMetric,
  liquidez_fci: LiquidezFciMetric,
};
