// Guard de administración: sesión válida + membresía en admin_users. admin_users no tiene
// políticas RLS para el cliente (ver 0020_admin_users.sql), así que este chequeo con el
// service-role es la ÚNICA manera de saber si alguien es admin — nunca confiar en nada que
// mande el cliente (headers, body, claims del JWT sin verificar acá).
import { type Env, sbHeaders, sbSelect } from '../_shared';

export interface AdminCtx { userId: string; email: string; }

interface GoTrueUser { id: string; email: string; }

export async function requireAdmin(env: Env, request: Request): Promise<AdminCtx | null> {
  const auth = request.headers.get('Authorization');
  if (!auth || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  let user: GoTrueUser;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    });
    if (!res.ok) return null;
    user = await res.json();
  } catch { return null; }
  if (!user?.id) return null;
  const rows = await sbSelect<{ user_id: string }>(env, 'admin_users', `user_id=eq.${user.id}&select=user_id`);
  return rows.length > 0 ? { userId: user.id, email: user.email } : null;
}

// Constancia de cada acción de administración — quién, qué, sobre quién, cuándo. Best-effort: un
// fallo de auditoría (ej. tabla momentáneamente inaccesible) nunca debe tirar abajo la operación
// real (banear/crear/eliminar), que ya sucedió.
export async function logAudit(env: Env, entry: {
  actorId: string; actorEmail: string; action: string;
  targetId?: string | null; targetEmail?: string | null; detalle?: unknown;
}): Promise<void> {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/admin_audit_log`, {
      method: 'POST',
      headers: sbHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        actor_id: entry.actorId,
        actor_email: entry.actorEmail,
        action: entry.action,
        target_id: entry.targetId ?? null,
        target_email: entry.targetEmail ?? null,
        detalle: entry.detalle ?? null,
      }),
    });
  } catch { /* auditoría best-effort, ver comentario arriba */ }
}
