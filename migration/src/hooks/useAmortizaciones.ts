import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { AmortizacionProgramada } from '../types/domain';

// Cronograma MANUAL de cuotas de amortización futuras — ver 0028_amortizaciones_programadas.sql.
// Se trae TODA la tabla (RLS ya la restringe a las posiciones del usuario, en cualquier portfolio —
// mismo criterio que usePosicionBrokers): el componente filtra por los posicion_id que necesite.
export function useAmortizaciones() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['amortizaciones_programadas', session?.user.id ?? 'anon'],
    enabled: !!session,
    queryFn: async (): Promise<AmortizacionProgramada[]> => {
      const { data, error } = await supabase.from('amortizaciones_programadas').select('*').order('fecha', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['amortizaciones_programadas'] });

  return {
    data: q.data ?? [],
    isLoading: q.isLoading,

    // Altas sueltas (no reemplaza la lista): el usuario va cargando cuotas de a una, a medida que
    // las va conociendo (ficha técnica del bono, comunicado de la emisora, etc.).
    agregar: async (input: { posicionId: string; fecha: string; porcentaje: number }) => {
      if (!(input.porcentaje > 0 && input.porcentaje <= 1)) throw new Error('El porcentaje debe ser mayor a 0% y hasta 100%.');
      const { error } = await supabase.from('amortizaciones_programadas').insert({
        posicion_id: input.posicionId, fecha: input.fecha, porcentaje: input.porcentaje,
      });
      // unique(posicion_id, fecha): si ya había una cuota cargada para esa fecha, el error de
      // Postgres es lo bastante claro (duplicate key) — no vale la pena una traducción especial acá.
      if (error) throw error;
      invalidate();
    },

    eliminar: async (id: string) => {
      const { error } = await supabase.from('amortizaciones_programadas').delete().eq('id', id);
      if (error) throw error;
      invalidate();
    },
  };
}
