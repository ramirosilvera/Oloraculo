import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface WatchItem {
  id: string;
  ticker: string;
  cik: string | null;
  nota: string | null;
  created_at: string;
}

export function useWatchlist() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['watchlist'],
    queryFn: async (): Promise<WatchItem[]> => {
      const { data, error } = await supabase.from('watchlist').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['watchlist'] });
  return {
    ...q,
    add: async (ticker: string, cik?: string | null, nota?: string | null) => {
      const { error } = await supabase.from('watchlist').insert({ ticker: ticker.toUpperCase().trim(), cik: cik || null, nota: nota || null });
      if (error) throw error; invalidate();
    },
    remove: async (id: string) => {
      const { error } = await supabase.from('watchlist').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}
