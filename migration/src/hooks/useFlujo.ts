import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { FlujoItem, FlujoCategoria } from '../types/domain';

// Flujo de caja del usuario. La key incluye el user_id: así la cache persistida en localStorage
// no rehidrata datos de otra cuenta que haya usado el mismo navegador.
export function useFlujo() {
  const { session } = useAuth();
  const uid = session?.user.id ?? 'anon';
  return useQuery({
    queryKey: ['flujo', uid],
    enabled: !!session,
    queryFn: async (): Promise<FlujoItem[]> => {
      const { data, error } = await supabase.from('flujo_items')
        .select('*').order('categoria', { ascending: true }).order('orden', { ascending: true }).order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useFlujoMutations() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['flujo'] });
  const now = () => new Date().toISOString();
  return {
    add: async (categoria: FlujoCategoria, patch: Partial<FlujoItem> = {}) => {
      if (!session) throw new Error('sin sesión');
      const { error } = await supabase.from('flujo_items').insert({
        user_id: session.user.id, categoria,
        concepto: patch.concepto ?? '', monto: patch.monto ?? 0,
        moneda: patch.moneda ?? 'ARS', destino: patch.destino ?? (categoria === 'inversion' ? 'fci' : null),
        orden: patch.orden ?? 0, activo: patch.activo ?? true, nota: patch.nota ?? null, updated_at: now(),
      });
      if (error) throw error; invalidate();
    },
    update: async (id: string, patch: Partial<FlujoItem>) => {
      const { error } = await supabase.from('flujo_items').update({ ...patch, updated_at: now() }).eq('id', id);
      if (error) throw error; invalidate();
    },
    remove: async (id: string) => {
      const { error } = await supabase.from('flujo_items').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}
