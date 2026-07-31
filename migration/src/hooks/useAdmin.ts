import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { api, type AdminAccion } from '../lib/api';

// ¿El usuario logueado es admin? Se resuelve server-side (Function + admin_users, sin RLS para el
// cliente — ver 0020_admin_users.sql) — nunca un chequeo puramente local/spoofable. Solo gatea la
// UI (mostrar u ocultar el nav); la seguridad real está en que cada endpoint /api/admin/* vuelve a
// verificar por su cuenta.
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['admin-whoami', session?.user.id ?? 'anon'],
    enabled: !!session,
    staleTime: 5 * 60_000,
    queryFn: () => api.adminWhoAmI(),
  });
  return { isAdmin: q.data?.isAdmin ?? false, isLoading: q.isLoading };
}

export function useAdminUsers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-users'], queryFn: () => api.adminUsers() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-users'] });
  return {
    users: q.data?.users ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    crear: async (body: { email: string; password: string; displayName?: string }) => {
      await api.adminCrearUsuario(body);
      invalidate();
    },
    accion: async (id: string, action: AdminAccion) => {
      await api.adminAccionUsuario(id, action);
      invalidate();
    },
    eliminar: async (id: string) => {
      await api.adminEliminarUsuario(id);
      invalidate();
    },
  };
}

export function useAdminAuditoria() {
  const q = useQuery({ queryKey: ['admin-audit'], queryFn: () => api.adminAuditoria() });
  return { entries: q.data?.entries ?? [], isLoading: q.isLoading };
}
