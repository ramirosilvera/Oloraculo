import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { api, type AdminAccion } from '../lib/api';

// ¿El usuario logueado es admin? ¿está aprobado para operar en la app? Se resuelve server-side
// (Function + admin_users/usuarios_aprobados, sin RLS para el cliente — ver 0020/0021) — nunca un
// chequeo puramente local/spoofable. isAdmin solo gatea la UI (mostrar u ocultar el nav de Admin);
// isApproved gatea la app entera en App.tsx (con "cuenta pendiente" si no). La seguridad real está
// en que cada endpoint /api/admin/* re-verifica admin por su cuenta, y en que la policy
// portfolios_insert exige is_approved() en la base — esto nunca es la única barrera.
export function useEstadoCuenta(): { isAdmin: boolean; isApproved: boolean; isLoading: boolean } {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['admin-whoami', session?.user.id ?? 'anon'],
    enabled: !!session,
    staleTime: 5 * 60_000,
    queryFn: () => api.adminWhoAmI(),
  });
  return { isAdmin: q.data?.isAdmin ?? false, isApproved: q.data?.isApproved ?? false, isLoading: q.isLoading };
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
