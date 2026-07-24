import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { DcfInputs } from '../engine/dcf';

// Supuestos guardados de un ticker = inputs del DCF + beta.
export type StoredDcf = DcfInputs & { beta: number };
interface DcfRow { ticker: string; inputs: StoredDcf }

// Supuestos de DCF guardados por el usuario, por ticker. El Análisis los edita/guarda y el Radar
// los usa para el score, así lo que ves en un lado coincide con el otro.
export function useDcfInputs() {
  const { session } = useAuth();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['dcf_inputs', session?.user.id ?? 'anon'],
    enabled: !!session,
    // Guardamos el ARRAY, no un Map: un Map NO serializa a JSON, y la cache persistida en
    // localStorage lo rehidrataba como {} → dcfMap.get() rompía ("u.get is not a function"). El
    // Map se arma en el hook a partir del array (JSON-safe).
    queryFn: async (): Promise<DcfRow[]> => {
      const { data, error } = await supabase.from('dcf_inputs').select('ticker, inputs');
      if (error) throw error;
      return (data ?? []) as DcfRow[];
    },
  });

  // Guard Array.isArray: una cache vieja persistida podía haber quedado como {} (Map serializado);
  // así no rompe hasta que refresca al array correcto.
  const map = useMemo(() => {
    const rows = Array.isArray(q.data) ? q.data : [];
    return new Map(rows.map(r => [r.ticker, r.inputs]));
  }, [q.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['dcf_inputs'] });

  return {
    map,
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
