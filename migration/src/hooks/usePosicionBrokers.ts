import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { PosicionBroker } from '../types/domain';

// Reparto de posiciones entre brokers — reemplaza posiciones.broker_id (ver 0018_posicion_brokers.sql).
// Se trae TODA la tabla (RLS ya la restringe a las posiciones del usuario, en cualquier portfolio —
// mismo criterio que useBrokers): el componente filtra por los posicion_id del portfolio activo,
// que ya tiene cargados vía usePosiciones. Evita depender de un join tipado con PostgREST.
export function usePosicionBrokers() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['posicion_brokers', session?.user.id ?? 'anon'],
    enabled: !!session,
    queryFn: async (): Promise<PosicionBroker[]> => {
      const { data, error } = await supabase.from('posicion_brokers').select('*');
      if (error) throw error;
      return data ?? [];
    },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['posicion_brokers'] });
  return {
    data: q.data ?? [],
    isLoading: q.isLoading,
    // Reemplaza TODA la lista de asignaciones de una posición de una sola vez (borra + inserta): la
    // UI edita la lista completa junta (ej. "80 en IOL" → "69 en IOL + 11 en Santander"), no altas
    // sueltas — evita dejar filas viejas huérfanas si el usuario cambia de broker en vez de sumar uno.
    setAsignaciones: async (posicionId: string, asignaciones: { brokerId: string; cantidad: number }[]) => {
      const { error: delErr } = await supabase.from('posicion_brokers').delete().eq('posicion_id', posicionId);
      if (delErr) throw delErr;
      const rows = asignaciones.filter(a => a.brokerId && a.cantidad > 0)
        .map(a => ({ posicion_id: posicionId, broker_id: a.brokerId, cantidad: a.cantidad }));
      if (rows.length) {
        const { error: insErr } = await supabase.from('posicion_brokers').insert(rows);
        if (insErr) throw insErr;
      }
      invalidate();
    },
  };
}
