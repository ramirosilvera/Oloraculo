import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export interface CikEntry { ticker: string; cik: string; beta: number | null }

// Overrides/adds del usuario para tickers que no están en el DEFAULT_CIK del servidor.
export function useCikMap() {
  const { session } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['cik_map', session?.user.id],
    enabled: !!session,
    queryFn: async (): Promise<CikEntry[]> => {
      const { data, error } = await supabase.from('cik_map').select('ticker, cik, beta').order('ticker');
      if (error) throw error;
      return data ?? [];
    },
  });

  return {
    ...query,
    map: new Map((query.data ?? []).map(e => [e.ticker, e])),
    add: async (ticker: string, cik: string, beta?: number | null) => {
      const { error } = await supabase.from('cik_map').upsert({
        user_id: session!.user.id, ticker: ticker.toUpperCase(), cik, beta: beta ?? null,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['cik_map'] });
    },
    remove: async (ticker: string) => {
      const { error } = await supabase.from('cik_map').delete().eq('ticker', ticker.toUpperCase());
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['cik_map'] });
    },
  };
}
