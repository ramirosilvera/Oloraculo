import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { DcfInputs } from '../engine/dcf';

// Supuestos guardados de un ticker = inputs del DCF + beta.
export type StoredDcf = DcfInputs & { beta: number };

// Supuestos de DCF guardados por el usuario, por ticker. El Análisis los edita/guarda y el Radar
// los usa para el score, así lo que ves en un lado coincide con el otro.
export function useDcfInputs() {
  const { session } = useAuth();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['dcf_inputs', session?.user.id ?? 'anon'],
    enabled: !!session,
    queryFn: async (): Promise<Map<string, StoredDcf>> => {
      const { data, error } = await supabase.from('dcf_inputs').select('ticker, inputs');
      if (error) throw error;
      return new Map((data ?? []).map(r => [r.ticker as string, r.inputs as StoredDcf]));
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['dcf_inputs'] });

  return {
    map: q.data ?? new Map<string, StoredDcf>(),
    isLoading: q.isLoading,
    save: async (ticker: string, inputs: StoredDcf) => {
      const { error } = await supabase.from('dcf_inputs').upsert({
        user_id: session!.user.id, ticker: ticker.toUpperCase(), inputs, updated_at: new Date().toISOString(),
      });
      if (error) throw error; invalidate();
    },
    remove: async (ticker: string) => {
      const { error } = await supabase.from('dcf_inputs').delete().eq('ticker', ticker.toUpperCase());
      if (error) throw error; invalidate();
    },
  };
}
