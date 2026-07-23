import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes, useMacro } from '../hooks/usePosiciones';
import { useAportes } from '../hooks/useAportes';
import { useFlujo } from '../hooks/useFlujo';
import { SEMAFOROS, GRUPOS, resumenMacro, type Luz, type Lectura, type ResumenMacro } from '../engine/semaforos';
import { resumenFlujo, DESTINOS_FCI } from '../engine/flujo';
import { portfolioTir } from '../engine/irr';
import { api } from '../lib/api';
import { useUltimoAnalisis, useSetUltimoAnalisis } from '../hooks/useAnalisisIA';
import { Card, CardHeader, Stat, Button, Badge, fmtUsd, fmtPct } from '../components/ui';
import { fmtArs, destinoLabel } from './FinanzasPage';
import { UpdatedAt } from '../components/UpdatedAt';
import { unitValueUSD as unitUSD } from '../lib/valuation';

const LUZ_BG: Record<Luz, string> = { verde: 'bg-pos/15 text-pos', amarillo: 'bg-warn/15 text-warn', rojo: 'bg-neg/15 text-neg' };

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

  const { patrimonio, costo, pnl } = useMemo(() => {
    let patrimonio = 0, costo = 0;
    for (const p of posiciones) {
      const u = unitUSD(p, quotes[p.ticker] ?? null);
      patrimonio += (u != null ? u * p.cantidad : p.precio_compra * p.cantidad);
      costo += p.precio_compra * p.cantidad;
    }
    return { patrimonio, costo, pnl: patrimonio - costo };
  }, [posiciones, quotes]);

  // TIR money-weighted: aportes (capital externo) + patrimonio actual como flujo terminal.
  // Fallback aproximado: costo de las posiciones abiertas en su fecha de compra.
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

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Dashboard · {active.nombre}</h1>
        <UpdatedAt icon />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Patrimonio" value={fmtUsd(patrimonio, 0)} />
        <Stat label="Costo" value={fmtUsd(costo, 0)} />
        <Stat label="P&L" value={fmtUsd(pnl, 0)} delta={costo > 0 ? pnl / costo : undefined} />
        <Stat label="Objetivo" value={fmtUsd(active.capital_objetivo, 0)} hint="capital objetivo del portfolio" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label={`TIR anual${tir.aproximada ? ' (aprox.)' : ''}`}
          value={<span className={tir.anual == null ? '' : tir.anual >= 0 ? 'text-pos' : 'text-neg'}>{tir.anual != null ? fmtPct(tir.anual) : '—'}</span>}
          hint={tir.base === 'aportes' ? 'money-weighted (XIRR) sobre tus aportes' : tir.base === 'costos' ? 'aproximada: sin aportes registrados, se usa el costo en fecha de compra' : 'cargá tus aportes (o fechas de compra) para calcularla'} />
        <Stat label="TIR histórica"
          value={<span className={tir.historica == null ? '' : tir.historica >= 0 ? 'text-pos' : 'text-neg'}>{tir.historica != null ? fmtPct(tir.historica) : '—'}</span>}
          hint="rendimiento total acumulado sobre el capital invertido" />
        <Stat label="Invertido" value={tir.invertido > 0 ? fmtUsd(tir.invertido, 0) : '—'}
          hint={tir.base === 'aportes' ? 'suma de tus aportes' : 'costo de las posiciones (sin aportes registrados)'} />
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-4 py-3 flex flex-col justify-center">
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold">Base de la TIR</p>
          <p className="text-sm font-semibold text-ink-800 mt-0.5">
            {tir.base === 'aportes' ? 'Aportes + valor actual' : tir.base === 'costos' ? 'Costo + valor actual' : 'Sin datos'}
          </p>
          {tir.base !== 'aportes' && (
            <Link to="/aportes" className="text-[11px] text-celeste-600 hover:underline mt-0.5">Cargar aportes →</Link>
          )}
        </div>
      </div>

      {flujo.length > 0 && <LiquidezFci resumen={flujoR} mep={mep} />}

      <MacroContext readings={semaforos} resumen={resumen} />

      <Card>
        <CardHeader title="Distribución por posición" />
        <div className="p-4 space-y-1.5">
          {posiciones.map(p => {
            const u = unitUSD(p, quotes[p.ticker] ?? null);
            const mkt = u != null ? u * p.cantidad : p.precio_compra * p.cantidad;
            const w = patrimonio > 0 ? mkt / patrimonio : 0;
            return (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className="w-16 font-semibold text-ink-800">{p.ticker}</span>
                <div className="flex-1 h-2 rounded-full bg-canvas overflow-hidden">
                  <div className="h-full bg-celeste-500 rounded-full" style={{ width: `${Math.min(100, w * 100)}%` }} />
                </div>
                <span className="w-12 text-right tnum text-ink-600">{fmtPct(w, 0)}</span>
                {p.peso_objetivo != null && <span className="w-16 text-right tnum text-[10px] text-ink-600">obj {fmtPct(p.peso_objetivo, 0)}</span>}
              </div>
            );
          })}
          {posiciones.length === 0 && <p className="text-sm text-ink-600">Sin posiciones. Cargalas en Posiciones.</p>}
        </div>
      </Card>
    </div>
  );
}

// Liquidez & FCI: la parte del flujo de caja que se muestra en el Dashboard (near-cash sleeve).
function LiquidezFci({ resumen, mep }: { resumen: ReturnType<typeof resumenFlujo>; mep: number | null }) {
  const sleeve = DESTINOS_FCI.map(d => ({ d, monto: resumen.porDestino[d] ?? 0 })).filter(x => x.monto > 0);
  const usd = (ars: number) => (mep ? `≈ US$${Math.round(ars / mep).toLocaleString('en-US')}` : '');
  return (
    <Card>
      <CardHeader title="Liquidez & FCI" sub="Lo que tenés en fondos y billetera, según tu flujo de caja."
        right={<Link to="/finanzas" className="text-[11px] text-celeste-600 hover:underline">Editar flujo →</Link>} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
        <Stat label="FCI + billetera" value={fmtArs(resumen.fci)} hint={usd(resumen.fci)} />
        <Stat label="Disponible del mes" value={<span className={resumen.disponible >= 0 ? 'text-pos' : 'text-neg'}>{fmtArs(resumen.disponible)}</span>} hint="ingresos − egresos" />
        <Stat label="Asignado" value={fmtArs(resumen.invertido)} hint="ya colocado en inversiones" />
        <Stat label="Sin asignar" value={<span className={resumen.sinAsignar >= 0 ? 'text-ink-900' : 'text-neg'}>{fmtArs(resumen.sinAsignar)}</span>} hint="todavía sin colocar" />
      </div>
      {sleeve.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {sleeve.map(({ d, monto }) => (
            <Badge key={d} tone="celeste">{destinoLabel(d)}: {fmtArs(monto)}</Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

const TONE_ALERTA: Record<'amarillo' | 'rojo', 'warn' | 'neg'> = { amarillo: 'warn', rojo: 'neg' };

// Contexto macro: síntesis narrativa (rule-based) + alertas + tablero agrupado + lectura opcional de IA.
function MacroContext({ readings, resumen }: { readings: Lectura[]; resumen: ResumenMacro }) {
  // Persistencia: la última lectura de IA guardada se muestra al abrir (no se pierde entre sesiones).
  const { texto: guardado, fecha } = useUltimoAnalisis('MACRO', 'macro');
  const setUltimo = useSetUltimoAnalisis();
  const [ia, setIa] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mostrado = ia ?? guardado;

  const conDatos = readings.filter(r => r.luz);

  async function explicar() {
    setBusy(true); setErr(null);
    const r = await api.analisisMacro({
      indicadores: conDatos.map(r => ({
        indicador: r.def.label,
        grupo: r.def.grupo,
        valor: r.valor != null && r.def.fmt ? r.def.fmt(r.valor) : r.valor,
        estado: r.luz,
      })),
    });
    if (r.error) setErr(r.error);
    else { setIa(r.analisis ?? ''); if (r.analisis) setUltimo('MACRO', 'macro', r.analisis); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader title="Contexto macro" sub="Semáforos de la planilla + lectura de la situación."
        right={<Badge tone={resumen.luz === 'rojo' ? 'neg' : resumen.luz === 'amarillo' ? 'warn' : 'pos'}>
          {resumen.titulo} · {resumen.conteo.rojos} 🔴 {resumen.conteo.amarillos} 🟡
        </Badge>} />

      {/* Síntesis narrativa (sin IA): siempre presente. */}
      <div className="px-4 pt-3">
        <p className="text-sm text-ink-800 leading-relaxed">{resumen.parrafo}</p>
        {resumen.alertas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {resumen.alertas.map(a => (
              <Badge key={a.key} tone={TONE_ALERTA[a.luz]}>{a.label}: {a.msg}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Tablero de indicadores agrupado por área. */}
      <div className="p-3 space-y-3">
        {GRUPOS.map(g => {
          const items = readings.filter(r => r.def.grupo === g.key);
          if (items.length === 0) return null;
          return (
            <div key={g.key}>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-600 mb-1.5 px-1">{g.label}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {items.map(({ def, valor, luz }) => (
                  <div key={def.key} className={`rounded-xl px-3 py-2.5 ring-1 ring-inset ${luz ? `${LUZ_BG[luz]} ring-black/[0.04]` : 'bg-canvas text-ink-600 ring-line'}`}>
                    <p className="text-[10px] uppercase tracking-wide font-semibold opacity-80">{def.label}</p>
                    <p className="text-base font-bold tnum mt-0.5">{valor != null ? (def.fmt ? def.fmt(valor) : valor) : '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lectura de IA opcional (interpreta lo cualitativo; los números ya los calculó el código). */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" onClick={explicar} disabled={busy || conDatos.length === 0}>
            <Sparkles className="w-4 h-4" /> {busy ? 'Analizando…' : mostrado ? 'Volver a analizar' : 'Explicar la situación (IA)'}
          </Button>
          {err && <span className="text-[11px] text-neg">No se pudo generar: {err}</span>}
        </div>
        {mostrado && (
          <div className="mt-2 rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2.5">
            <p className="text-sm text-ink-800 leading-relaxed whitespace-pre-wrap break-words">{mostrado}</p>
            <p className="text-[10px] text-ink-600 mt-1.5">
              Lectura cualitativa generada por IA · los valores y semáforos los calcula el código.
              {!ia && fecha && ` · guardada ${new Date(fecha).toLocaleString('es-AR')}`}
            </p>
          </div>
        )}
      </div>

      <p className="px-4 pb-3 text-[11px] text-ink-600">
        Dólares y riesgo país (ARG), tasas + VIX + índice dólar amplio (FRED), S&P 500/oro/BTC/ADR YPF
        (Finnhub; S&P≈SPY×10, oro≈GLD×10) y Merval USD (Yahoo ^MERV ÷ CCL).
      </p>
    </Card>
  );
}
