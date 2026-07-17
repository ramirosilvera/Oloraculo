import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Base compartida ticker → ratio (subyacentes por CEDEAR). Pre-llena el alta; se
// auto-completa con lo que carga el usuario.
export function useCedearRatios() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['cedear_ratios'],
    staleTime: 24 * 60 * 60_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.from('cedear_ratios').select('ticker, ratio');
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of data ?? []) map[r.ticker] = r.ratio;
      return map;
    },
  });
  return {
    ratios: query.data ?? {},
    isLoading: query.isLoading,
    // Guarda/actualiza un ratio en la base (best-effort, no rompe el alta si falla).
    saveRatio: async (ticker: string, ratio: number) => {
      if (!ticker || !(ratio > 0)) return;
      try {
        await supabase.from('cedear_ratios').upsert({ ticker: ticker.toUpperCase(), ratio, updated_at: new Date().toISOString() });
        qc.invalidateQueries({ queryKey: ['cedear_ratios'] });
      } catch { /* base opcional */ }
    },
  };
}
