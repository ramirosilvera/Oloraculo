// Typed fetchers for the Pages Functions (all external data goes through them).
import type { Fundamentals } from '../types/domain';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

export const api = {
  fundamentals: (ticker: string, cik?: string, fresh?: boolean) =>
    get<Fundamentals & { warning?: string; cached?: boolean }>(
      `/api/market/fundamentals?ticker=${encodeURIComponent(ticker)}${cik ? `&cik=${cik}` : ''}${fresh ? '&fresh=1' : ''}`),

  quotes: (tickers: string[]) =>
    get<Record<string, number | null>>(`/api/market/quotes?tickers=${tickers.map(encodeURIComponent).join(',')}`),

  fx: () => get<Record<string, number | null>>('/api/market/fx'),
  riesgoPais: () => get<{ riesgo_pais: number | null }>('/api/market/riesgo-pais'),
  fred: () => get<Record<string, number | null>>('/api/market/fred'),
  indicadores: () => get<Record<string, number | null>>('/api/market/indicadores'),
  status: () => get<{ precios: string | null; macro: string | null; fundamentals: string | null; last: string | null }>('/api/market/status'),
  bonos: () => get<Record<string, number>>('/api/market/bonos'),
  accionesAr: (tickers: string[]) =>
    get<{ mep: number | null; precios: Record<string, number | null> }>(
      `/api/market/acciones-ar?tickers=${tickers.map(encodeURIComponent).join(',')}`),

  analisisEmpresa: (body: unknown) => postAnalisis('/api/analysis/empresa', body),
  analisisPortfolio: (body: unknown) => postAnalisis('/api/analysis/portfolio', body),
  analisisMacro: (body: unknown) => postAnalisis('/api/analysis/macro', body),
};

// Nunca rechaza: devuelve {error} ante fallo de red/HTTP para que el botón no quede colgado.
async function postAnalisis(path: string, body: unknown): Promise<{ analisis?: string; error?: string; cached?: boolean }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
    return data;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'red' };
  }
}
