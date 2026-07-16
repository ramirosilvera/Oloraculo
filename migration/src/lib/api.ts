// Typed fetchers for the Pages Functions (all external data goes through them).
import type { Fundamentals } from '../types/domain';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

export const api = {
  fundamentals: (ticker: string, cik?: string) =>
    get<Fundamentals & { warning?: string; cached?: boolean }>(
      `/api/market/fundamentals?ticker=${encodeURIComponent(ticker)}${cik ? `&cik=${cik}` : ''}`),

  quotes: (tickers: string[]) =>
    get<Record<string, number | null>>(`/api/market/quotes?tickers=${tickers.map(encodeURIComponent).join(',')}`),

  fx: () => get<Record<string, number | null>>('/api/market/fx'),
  riesgoPais: () => get<{ riesgo_pais: number | null }>('/api/market/riesgo-pais'),
  fred: () => get<Record<string, number | null>>('/api/market/fred'),
  bonos: () => get<Record<string, number>>('/api/market/bonos'),

  analisisEmpresa: (body: unknown) =>
    fetch('/api/analysis/empresa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json()) as Promise<{ analisis?: string; error?: string; cached?: boolean }>,

  analisisPortfolio: (body: unknown) =>
    fetch('/api/analysis/portfolio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json()) as Promise<{ analisis?: string; error?: string }>,
};
