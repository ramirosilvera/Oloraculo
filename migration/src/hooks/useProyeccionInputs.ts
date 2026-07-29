import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ProyeccionInputs {
  aporteAnual: number;
  tasaAnual: number;
  anios: number;
  edadInicial: number;
}

// Supuestos de Proyección guardados por PORTFOLIO (el valor inicial ya es del portfolio activo,
// así que el resto de los supuestos viaja con él). Sin esto se perdían al recargar la página.
export function useProyeccionInputs(portfolioId: string | undefined) {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['proyeccion_inputs', portfolioId ?? ''],
    enabled: !!portfolioId,
    queryFn: async (): Promise<ProyeccionInputs | null> => {
      const { data, error } = await supabase.from('proyeccion_inputs').select('inputs').eq('portfolio_id', portfolioId).maybeSingle();
      if (error) throw error;
      return (data?.inputs as ProyeccionInputs | undefined) ?? null;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['proyeccion_inputs', portfolioId ?? ''] });

  return {
    data: q.data ?? null,
    isLoading: q.isLoading,
    save: async (inputs: ProyeccionInputs) => {
      if (!portfolioId) return;
      const { error } = await supabase.from('proyeccion_inputs').upsert({ portfolio_id: portfolioId, inputs, updated_at: new Date().toISOString() });
      if (error) throw error; invalidate();
    },
    remove: async () => {
      if (!portfolioId) return;
      const { error } = await supabase.from('proyeccion_inputs').delete().eq('portfolio_id', portfolioId);
      if (error) throw error; invalidate();
    },
  };
}
