import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { DEFAULT_LAYOUT } from '../engine/dashboardCatalog';
import type { DashboardWidget, SeccionKey } from '../types/domain';

// Layout del Dashboard personalizable — 1 fila JSONB por usuario (0029_dashboard_layout.sql), GLOBAL
// (no por portfolio, mismo criterio que Liquidez & FCI). Sin fila todavía (usuario que nunca
// personalizó) se renderiza DEFAULT_LAYOUT sin escribir nada — a propósito no hay "sembrado" en el
// primer load: eso eliminaría cualquier carrera de doble-insert (dos pestañas, StrictMode) de raíz.
export function useDashboardLayout() {
  const qc = useQueryClient();
  const { session } = useAuth();

  const q = useQuery({
    queryKey: ['dashboard_layout', session?.user.id ?? 'anon'],
    enabled: !!session,
    queryFn: async (): Promise<DashboardWidget[] | null> => {
      const { data, error } = await supabase.from('dashboard_layout').select('widgets').maybeSingle();
      if (error) throw error;
      return (data?.widgets as DashboardWidget[] | undefined) ?? null;
    },
  });

  const widgets = q.data ?? DEFAULT_LAYOUT;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['dashboard_layout', session?.user.id ?? 'anon'] });

  const save = async (next: DashboardWidget[]) => {
    if (!session) return;
    const { error } = await supabase.from('dashboard_layout')
      .upsert({ user_id: session.user.id, widgets: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    invalidate();
  };

  return {
    widgets,
    // false = todavía usando DEFAULT_LAYOUT (nunca personalizó); true = tiene layout propio guardado
    // (aunque coincida en contenido con el default) — distingue "sin fila" de "fila con 0 tarjetas".
    isCustom: q.data != null,
    isLoading: q.isLoading,
    save,
    agregar: (w: Omit<Extract<DashboardWidget, { kind: 'metrica' }>, 'id'>) =>
      save([...widgets, { ...w, id: crypto.randomUUID() }]),
    agregarSeccion: (seccion: SeccionKey) =>
      save([...widgets, { id: crypto.randomUUID(), kind: 'seccion', seccion }]),
    actualizar: (id: string, patch: Partial<DashboardWidget>) =>
      save(widgets.map(w => (w.id === id ? ({ ...w, ...patch } as DashboardWidget) : w))),
    eliminar: (id: string) => save(widgets.filter(w => w.id !== id)),
    mover: (id: string, dir: 'arriba' | 'abajo') => {
      const i = widgets.findIndex(w => w.id === id);
      const j = dir === 'arriba' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= widgets.length) return Promise.resolve();
      const next = [...widgets];
      [next[i], next[j]] = [next[j], next[i]];
      return save(next);
    },
    restaurarDefault: () => save(DEFAULT_LAYOUT),
  };
}
