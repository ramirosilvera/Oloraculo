import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { DEFAULT_LAYOUT } from '../engine/dashboardCatalog';
import type { DashboardWidget, SeccionKey } from '../types/domain';

// Chequeo de forma mínimo (no valida que `metrica`/`seccion` existan en el catálogo — eso lo hace
// WidgetGrid en cada render, porque el catálogo puede cambiar con el tiempo; acá solo se descarta lo
// que ni siquiera tiene la forma de un widget) — protege contra una fila corrupta (drift de schema,
// edición manual) tirando abajo toda la página al hacer `.map()` sobre algo que no es un array.
function esWidgetValido(w: unknown): w is DashboardWidget {
  if (!w || typeof w !== 'object') return false;
  const o = w as Record<string, unknown>;
  if (typeof o.id !== 'string') return false;
  if (o.kind === 'seccion') return typeof o.seccion === 'string';
  if (o.kind === 'metrica') return typeof o.metrica === 'string' && typeof o.viz === 'string';
  return false;
}

// `null` = no hay nada usable (la columna no es ni siquiera un array) → el caller cae a
// DEFAULT_LAYOUT. Un array válido pero vacío (`[]`) es un resultado legítimo distinto de `null`
// (ver `isCustom` más abajo), aunque el render también lo trate como "usar default" — ver `widgets`.
function parseWidgets(raw: unknown): DashboardWidget[] | null {
  if (!Array.isArray(raw)) return null;
  const vistos = new Set<string>();
  const out: DashboardWidget[] = [];
  for (const item of raw) {
    if (!esWidgetValido(item) || vistos.has(item.id)) continue; // ids duplicados → keys de React rotas
    vistos.add(item.id);
    out.push(item);
  }
  return out;
}

// Layout del Dashboard personalizable — 1 fila JSONB por usuario (0029_dashboard_layout.sql), GLOBAL
// (no por portfolio, mismo criterio que Liquidez & FCI). Sin fila todavía (usuario que nunca
// personalizó) O con un array vacío (se quedó sin tarjetas) se renderiza DEFAULT_LAYOUT sin escribir
// nada — a propósito no hay "sembrado" en el primer load: eso eliminaría cualquier carrera de
// doble-insert (dos pestañas, StrictMode) de raíz.
export function useDashboardLayout() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const queryKey = ['dashboard_layout', session?.user.id ?? 'anon'];

  const q = useQuery({
    queryKey,
    enabled: !!session,
    queryFn: async (): Promise<DashboardWidget[] | null> => {
      const { data, error } = await supabase.from('dashboard_layout').select('widgets').maybeSingle();
      if (error) throw error;
      return parseWidgets(data?.widgets);
    },
  });

  const widgets = q.data && q.data.length > 0 ? q.data : DEFAULT_LAYOUT;

  const persist = async (next: DashboardWidget[]) => {
    if (!session) return;
    // Optimista: se escribe en caché ANTES de esperar la red, así una segunda acción disparada
    // rápido (doble click en mover/eliminar) parte del estado recién escrito, no del que había al
    // momento del primer render — sin esto, dos acciones seguidas podían pisarse entre sí.
    qc.setQueryData(queryKey, next);
    const { error } = await supabase.from('dashboard_layout')
      .upsert({ user_id: session.user.id, widgets: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { qc.invalidateQueries({ queryKey }); throw error; } // revierte al estado real del server
    qc.invalidateQueries({ queryKey });
  };

  // Todas las acciones parten del valor MÁS RECIENTE en caché (no del `widgets` cerrado en este
  // render) — mismo motivo que el comentario de `persist` de arriba.
  const mutate = (updater: (prev: DashboardWidget[]) => DashboardWidget[]) => {
    const cached = qc.getQueryData<DashboardWidget[] | null>(queryKey);
    const base = cached && cached.length > 0 ? cached : DEFAULT_LAYOUT;
    const next = updater(base);
    if (next === base) return Promise.resolve(); // no-op (ej. mover en el borde) — no pega a la red
    return persist(next);
  };

  return {
    widgets,
    // false = todavía usando DEFAULT_LAYOUT (nunca personalizó, o vació su layout); true = tiene
    // layout propio guardado — distingue "sin fila usable" de "fila con contenido real".
    isCustom: q.data != null && q.data.length > 0,
    isLoading: q.isLoading,
    save: persist,
    agregar: (w: Omit<Extract<DashboardWidget, { kind: 'metrica' }>, 'id'>) =>
      mutate(prev => [...prev, { ...w, id: crypto.randomUUID() }]),
    agregarSeccion: (seccion: SeccionKey) =>
      mutate(prev => [...prev, { id: crypto.randomUUID(), kind: 'seccion', seccion }]),
    actualizar: (id: string, patch: Partial<Omit<Extract<DashboardWidget, { kind: 'metrica' }>, 'id' | 'kind' | 'metrica'>>) =>
      mutate(prev => prev.map(w => (w.id === id && w.kind === 'metrica' ? { ...w, ...patch } : w))),
    eliminar: (id: string) => mutate(prev => prev.filter(w => w.id !== id)),
    mover: (id: string, dir: 'arriba' | 'abajo') => mutate(prev => {
      const i = prev.findIndex(w => w.id === id);
      const j = dir === 'arriba' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }),
    restaurarDefault: () => persist(DEFAULT_LAYOUT),
  };
}
