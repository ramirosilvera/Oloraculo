import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Aporte } from '../types/domain';

export function useAportes(portfolioId: string | null | undefined) {
  return useQuery({
    queryKey: ['aportes', portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Aporte[]> => {
      const { data, error } = await supabase.from('aportes')
        .select('*').eq('portfolio_id', portfolioId).order('fecha', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAporteMutations(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['aportes'] });
  return {
    add: async (a: Omit<Aporte, 'id' | 'portfolio_id'>) => {
      const { error } = await supabase.from('aportes').insert({ ...a, portfolio_id: portfolioId });
      if (error) throw error; invalidate();
    },
    remove: async (id: string) => {
      const { error } = await supabase.from('aportes').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}
