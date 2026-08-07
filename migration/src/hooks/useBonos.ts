import { useEffect, useState } from 'react';
import { usePosiciones, useQuotes } from './usePosiciones';
import { calcularBono, type BonoCalc } from '../engine/bonos';

export type { BonoCalc } from '../engine/bonos';
export { resumenBonos, alertasBonos, type ResumenBonos } from '../engine/bonos';

// Cálculo compartido por bono (capital, mercado, TIR, duración, rating) — usado tanto por la
// tabla+gráfico de BonosPage como por el resumen del Dashboard, así nunca se desincronizan entre sí
// (mismo criterio que useRadarTicker para Radar/Dashboard). El cálculo en sí (calcularBono) es puro
// y vive en engine/bonos.ts — acá solo se resuelve el fetch (posiciones + cotizaciones).
export function useBonosCalc(portfolioId: string | undefined) {
  const { data: posiciones = [], isLoading } = usePosiciones(portfolioId);
  const bonos = posiciones.filter(p => p.tipo === 'bono');
  const { data: quotes = {} } = useQuotes([], bonos.map(b => b.ticker));
  const hoy = new Date().toISOString().slice(0, 10);

  const bonosCalc: BonoCalc[] = bonos.map(b => calcularBono(b, quotes[b.ticker] ?? null, hoy));

  return { bonos, bonosCalc, isLoading };
}

// Objetivo de "corto plazo" (años de duración) y qué % del capital en bonos querés ahí — es una
// preferencia de visualización personal (no afecta cálculos de otras pantallas), así que se
// persiste en localStorage por portfolio, igual que el patrón de usePrefs.ts. Compartido entre
// BonosPage y el resumen del Dashboard para que muestren siempre el mismo objetivo.
export const DEFAULT_ANIOS_CORTO_PLAZO = 2;
export const DEFAULT_PCT_CORTO_PLAZO = 60;
// Umbrales personales de alerta (no afectan cálculos, solo cuándo avisar) — mismo criterio y mismo
// localStorage por portfolio que anios/pct de arriba.
export const DEFAULT_MIN_GRADO_INVERSION_PCT = 50;  // % mínimo del capital en bonos que querés en grado de inversión
export const DEFAULT_MAX_DURACION_ANIOS = 4;        // duración promedio máxima aceptable (años)

export function useObjetivoDuracion(portfolioId: string | undefined) {
  const key = portfolioId ? `bonos.objetivoDuracion.${portfolioId}` : null;
  const [anios, setAniosState] = useState(DEFAULT_ANIOS_CORTO_PLAZO);
  const [pct, setPctState] = useState(DEFAULT_PCT_CORTO_PLAZO);
  const [minGradoInversionPct, setMinGradoState] = useState(DEFAULT_MIN_GRADO_INVERSION_PCT);
  const [maxDuracionAnios, setMaxDuracionState] = useState(DEFAULT_MAX_DURACION_ANIOS);

  useEffect(() => {
    let a = DEFAULT_ANIOS_CORTO_PLAZO, p = DEFAULT_PCT_CORTO_PLAZO,
      g = DEFAULT_MIN_GRADO_INVERSION_PCT, d = DEFAULT_MAX_DURACION_ANIOS;
    try {
      const raw = key ? localStorage.getItem(key) : null;
      if (raw) {
        const o = JSON.parse(raw);
        if (Number.isFinite(o.anios) && o.anios > 0) a = o.anios;
        if (Number.isFinite(o.pct) && o.pct >= 0 && o.pct <= 100) p = o.pct;
        if (Number.isFinite(o.minGradoInversionPct) && o.minGradoInversionPct >= 0 && o.minGradoInversionPct <= 100) g = o.minGradoInversionPct;
        if (Number.isFinite(o.maxDuracionAnios) && o.maxDuracionAnios > 0) d = o.maxDuracionAnios;
      }
    } catch { /* */ }
    setAniosState(a); setPctState(p); setMinGradoState(g); setMaxDuracionState(d);
  }, [key]);

  const persist = (a: number, p: number, g: number, d: number) => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ anios: a, pct: p, minGradoInversionPct: g, maxDuracionAnios: d })); } catch { /* */ }
  };
  return {
    anios, pct, minGradoInversionPct, maxDuracionAnios,
    setAnios: (a: number) => { setAniosState(a); persist(a, pct, minGradoInversionPct, maxDuracionAnios); },
    setPct: (p: number) => { setPctState(p); persist(anios, p, minGradoInversionPct, maxDuracionAnios); },
    setMinGradoInversionPct: (g: number) => { setMinGradoState(g); persist(anios, pct, g, maxDuracionAnios); },
    setMaxDuracionAnios: (d: number) => { setMaxDuracionState(d); persist(anios, pct, minGradoInversionPct, d); },
  };
}
