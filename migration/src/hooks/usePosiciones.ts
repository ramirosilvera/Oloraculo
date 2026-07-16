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

// Live prices for a set of tickers (equities via quotes, bonds via bonos).
export function useQuotes(tickers: string[], bondTickers: string[] = []) {
  return useQuery({
    queryKey: ['quotes', [...tickers].sort().join(','), [...bondTickers].sort().join(',')],
    enabled: tickers.length > 0 || bondTickers.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, number | null>> => {
      const [eq, bo] = await Promise.all([
        tickers.length ? api.quotes(tickers) : Promise.resolve({}),
        bondTickers.length ? api.bonos() : Promise.resolve({}),
      ]);
      const out: Record<string, number | null> = { ...eq };
      for (const t of bondTickers) out[t] = (bo as Record<string, number>)[t] ?? null;
      return out;
    },
  });
}

export function useMacro() {
  return useQuery({
    queryKey: ['macro'],
    staleTime: 15 * 60_000,
    queryFn: async () => {
      const [fx, rp, fred] = await Promise.all([api.fx(), api.riesgoPais(), api.fred()]);
      return { ...fx, riesgo_pais: rp.riesgo_pais, ...fred } as Record<string, number | null>;
    },
  });
}
