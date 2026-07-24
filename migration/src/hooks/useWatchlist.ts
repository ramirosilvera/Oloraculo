import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export interface WatchItem {
  id: string;
  ticker: string;
  cik: string | null;
  nota: string | null;
  created_at: string;
}

export function useWatchlist() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const q = useQuery({
    // user_id en la key: evita rehidratar la watchlist de otra cuenta desde la cache persistida.
    queryKey: ['watchlist', session?.user.id ?? 'anon'],
    enabled: !!session,
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
      // upsert (no insert): la tabla tiene unique(user_id,ticker); seguir un ticker que ya estaba
      // devolvía un error crudo de constraint. Ahora es idempotente y actualiza la nota.
      const { error } = await supabase.from('watchlist')
        .upsert({ ticker: ticker.toUpperCase().trim(), cik: cik || null, nota: nota || null }, { onConflict: 'user_id,ticker' });
      if (error) throw error; invalidate();
    },
    remove: async (id: string) => {
      const { error } = await supabase.from('watchlist').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}
