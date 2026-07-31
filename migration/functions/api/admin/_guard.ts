// Guard de administración: sesión válida + membresía en admin_users/usuarios_aprobados. Ninguna
// de las dos tiene políticas RLS para el cliente (ver 0020_admin_users.sql, 0021_aprobacion_cuentas.sql),
// así que este chequeo con el service-role es la ÚNICA manera de saber si alguien es admin o está
// aprobado — nunca confiar en nada que mande el cliente (headers, body, claims del JWT sin
// verificar acá).
import { type Env, sbHeaders, sbSelect } from '../_shared';

export interface AdminCtx { userId: string; email: string; }
export interface CuentaCtx { userId: string; email: string; isAdmin: boolean; isApproved: boolean; }

interface GoTrueUser { id: string; email: string; }

async function getUser(env: Env, request: Request): Promise<GoTrueUser | null> {
  const auth = request.headers.get('Authorization');
  if (!auth || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    });
    if (!res.ok) return null;
    const user: GoTrueUser = await res.json();
    return user?.id ? user : null;
  } catch { return null; }
}

// Estado completo de la cuenta que llama: admin (bypassa la aprobación, ver is_approved() en la
// migración) y/o aprobada explícitamente. Base de whoami.ts (gatea la UI) y de cualquier chequeo
// futuro que necesite ambos datos en una sola vuelta.
export async function estadoCuenta(env: Env, request: Request): Promise<CuentaCtx | null> {
  const user = await getUser(env, request);
  if (!user) return null;
  const [adminRows, aprobadoRows] = await Promise.all([
    sbSelect<{ user_id: string }>(env, 'admin_users', `user_id=eq.${user.id}&select=user_id`),
    sbSelect<{ user_id: string }>(env, 'usuarios_aprobados', `user_id=eq.${user.id}&select=user_id`),
  ]);
  const isAdmin = adminRows.length > 0;
  return { userId: user.id, email: user.email, isAdmin, isApproved: isAdmin || aprobadoRows.length > 0 };
}

export async function requireAdmin(env: Env, request: Request): Promise<AdminCtx | null> {
  const c = await estadoCuenta(env, request);
  return c?.isAdmin ? { userId: c.userId, email: c.email } : null;
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
