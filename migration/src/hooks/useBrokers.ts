import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Broker } from '../types/domain';

// Brokers: lista GLOBAL del usuario (no por portfolio) — ver 0016_brokers.sql.
export function useBrokers() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const q = useQuery({
    // user_id en la key: evita rehidratar los brokers de otra cuenta desde la cache persistida.
    queryKey: ['brokers', session?.user.id ?? 'anon'],
    enabled: !!session,
    queryFn: async (): Promise<Broker[]> => {
      const { data, error } = await supabase.from('brokers').select('*').order('nombre', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['brokers'] });
    qc.invalidateQueries({ queryKey: ['posicion_brokers'] });
  };
  return {
    data: q.data ?? [],
    isLoading: q.isLoading,
    add: async (nombre: string) => {
      const n = nombre.trim();
      if (!n) throw new Error('Ingresá un nombre.');
      const { error } = await supabase.from('brokers').insert({ nombre: n });
      // El índice único (user_id, lower(nombre)) da un 23505 si ya existe — mensaje más claro.
      if (error) throw new Error(error.code === '23505' ? `Ya tenés un broker llamado "${n}".` : error.message);
      invalidate();
    },
    // Al borrar un broker se borran (cascade) sus filas en posicion_brokers — la posición en sí NO
    // se toca, solo pierde esa asignación y su cantidad vuelve a contar como "Sin asignar".
    remove: async (id: string) => {
      const { error } = await supabase.from('brokers').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}
