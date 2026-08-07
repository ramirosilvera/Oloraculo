import { usePosiciones, useQuotes } from './usePosiciones';
import { calcularCedear, type CedearCalc } from '../engine/cedears';

export type { CedearCalc } from '../engine/cedears';
export { resumenCedears, type ResumenCedears } from '../engine/cedears';

// Cálculo compartido por CEDEAR (valor de mercado, sector, rol) — mismo criterio que
// useBonosCalc/useRadarTicker: el fetch vive acá, el cálculo puro vive en engine/cedears.ts.
export function useCedearsCalc(portfolioId: string | undefined) {
  const { data: posiciones = [], isLoading } = usePosiciones(portfolioId);
  const cedears = posiciones.filter(p => p.tipo === 'cedear');
  const { data: quotes = {} } = useQuotes(cedears.map(c => c.ticker), [], []);

  const cedearsCalc: CedearCalc[] = cedears.map(c => calcularCedear(c, quotes[c.ticker] ?? null));

  return { cedears, cedearsCalc, isLoading };
}
