import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import type { Posicion } from '../types/domain';

export function usePosiciones(portfolioId: string | null | undefined) {
  return useQuery({
    queryKey: ['posiciones', portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Posicion[]> => {
      const { data, error } = await supabase.from('posiciones')
        .select('*').eq('portfolio_id', portfolioId).order('peso_objetivo', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// All positions across the user's active portfolios (for the consolidated view).
export function useAllPosiciones(enabled: boolean) {
  return useQuery({
    queryKey: ['posiciones', 'all'],
    enabled,
    queryFn: async (): Promise<Posicion[]> => {
      const { data, error } = await supabase.from('posiciones').select('*');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePosicionMutations(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['posiciones'] });
  return {
    add: async (p: Partial<Posicion>) => {
      const { error } = await supabase.from('posiciones').insert({ ...p, portfolio_id: portfolioId });
      if (error) throw error; invalidate();
    },
    update: async (id: string, patch: Partial<Posicion>) => {
      const { error } = await supabase.from('posiciones').update(patch).eq('id', id);
      if (error) throw error; invalidate();
    },
    remove: async (id: string) => {
      const { error } = await supabase.from('posiciones').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}

// Live prices (US equities via Finnhub/FMP, bonds via data912, AR stocks via data912+MEP).
export function useQuotes(tickers: string[], bondTickers: string[] = [], arTickers: string[] = []) {
  return useQuery({
    queryKey: ['quotes', [...tickers].sort().join(','), [...bondTickers].sort().join(','), [...arTickers].sort().join(',')],
    enabled: tickers.length > 0 || bondTickers.length > 0 || arTickers.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, number | null>> => {
      const [eq, bo, ar] = await Promise.allSettled([
        tickers.length ? api.quotes(tickers) : Promise.resolve({}),
        bondTickers.length ? api.bonos() : Promise.resolve({}),
        arTickers.length ? api.accionesAr(arTickers) : Promise.resolve({ precios: {} }),
      ]);
      const out: Record<string, number | null> = {};
      if (eq.status === 'fulfilled') Object.assign(out, eq.value);
      if (bo.status === 'fulfilled') for (const t of bondTickers) out[t] = (bo.value as Record<string, number>)[t] ?? null;
      if (ar.status === 'fulfilled') for (const t of arTickers) out[t] = (ar.value as { precios: Record<string, number | null> }).precios?.[t] ?? null;
      return out;
    },
  });
}

export function useMacro() {
  return useQuery({
    queryKey: ['macro'],
    staleTime: 15 * 60_000,
    queryFn: async () => {
      // allSettled: si una fuente cae (ej. riesgo-país 502), las demás igual se muestran.
      const [fx, rp, fred, ind] = await Promise.allSettled([api.fx(), api.riesgoPais(), api.fred(), api.indicadores()]);
      const out: Record<string, number | null> = {};
      if (fx.status === 'fulfilled') Object.assign(out, fx.value);
      if (rp.status === 'fulfilled') out.riesgo_pais = rp.value.riesgo_pais;
      if (fred.status === 'fulfilled') Object.assign(out, fred.value);
      if (ind.status === 'fulfilled') Object.assign(out, ind.value);
      return out;
    },
  });
}
