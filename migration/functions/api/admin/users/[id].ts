// Panel admin — acciones sobre un usuario puntual: banear/reactivar, otorgar/revocar admin
// (PATCH), eliminar definitivamente (DELETE). Mismo guard que users.ts: requireAdmin() en cada
// request. Ningún admin puede aplicarse estas acciones a sí mismo — evita quedarse afuera por
// error (auto-banearse) o dejar la cuenta sin ningún admin (auto-revocarse/auto-eliminarse).
import { type Env, json, preflight, guard, sbHeaders } from '../../_shared';
import { requireAdmin, logAudit } from '../_guard';

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

const BAN_LARGO = '876000h'; // ~100 años — "baneado" en la práctica, reversible con ban_duration: 'none'

type Accion = 'ban' | 'unban' | 'grant_admin' | 'revoke_admin';
const ACCIONES: Accion[] = ['ban', 'unban', 'grant_admin', 'revoke_admin'];
const SOLO_A_OTROS: Accion[] = ['ban', 'revoke_admin']; // no te las podés aplicar a vos mismo

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// targetId sale de la URL (params.id) y se interpola sin escapar en un filtro PostgREST
// (?user_id=eq.${targetId}) y en un path de la Admin Auth API (/admin/users/${targetId}). Un id
// que no sea un UUID bien formado (ej. con "&" u otro separador de PostgREST) podría alterar el
// filtro previsto — validar ACÁ, antes de construir cualquier URL, lo descarta de raíz.
function idInvalido(targetId: string): boolean { return !UUID_RE.test(targetId); }

export const onRequestPatch = guard(async ({ request, env, params }) => {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'no-autorizado', detail: 'Necesitás ser administrador.' }, 403);

  const targetId = String(params.id);
  if (idInvalido(targetId)) return json({ error: 'id-invalido' }, 400);
  let body: { action?: string };
  try { body = await request.json(); } catch { return json({ error: 'body-invalido' }, 400); }
  const accion = body.action as Accion;
  if (!ACCIONES.includes(accion)) return json({ error: 'accion-invalida', detail: `action debe ser una de: ${ACCIONES.join(', ')}` }, 400);
  if (SOLO_A_OTROS.includes(accion) && targetId === admin.userId) {
    return json({ error: 'no-permitido', detail: 'No podés aplicarte esta acción a vos mismo.' }, 400);
  }

  if (accion === 'ban' || accion === 'unban') {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${targetId}`, {
      method: 'PUT', headers: sbHeaders(env),
      body: JSON.stringify({ ban_duration: accion === 'ban' ? BAN_LARGO : 'none' }),
    });
    if (!res.ok) return json({ error: 'gotrue-error', detail: `No se pudo ${accion === 'ban' ? 'banear' : 'reactivar'} (HTTP ${res.status})` }, 502);
  } else if (accion === 'grant_admin') {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_users`, {
      method: 'POST', headers: sbHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ user_id: targetId, granted_by: admin.userId }),
    });
    if (!res.ok) return json({ error: 'db-error', detail: `No se pudo otorgar admin (HTTP ${res.status})` }, 502);
  } else {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_users?user_id=eq.${targetId}`, {
      method: 'DELETE', headers: sbHeaders(env, { Prefer: 'return=minimal' }),
    });
    if (!res.ok) return json({ error: 'db-error', detail: `No se pudo revocar admin (HTTP ${res.status})` }, 502);
  }

  const ACCION_LOG: Record<Accion, string> = { ban: 'banear', unban: 'reactivar', grant_admin: 'otorgar_admin', revoke_admin: 'revocar_admin' };
  await logAudit(env, { actorId: admin.userId, actorEmail: admin.email, action: ACCION_LOG[accion], targetId });
  return json({ ok: true });
});

// Eliminación definitiva: borra el usuario de auth.users. Cascada por FK on delete cascade a
// profiles/portfolios/posiciones/aportes/dcf_analisis/cik_map/admin_users (ver 0001/0020) — no
// queda nada huérfano. No tiene deshacer; el frontend exige confirmación explícita antes de llamar.
export const onRequestDelete = guard(async ({ request, env, params }) => {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'no-autorizado', detail: 'Necesitás ser administrador.' }, 403);

  const targetId = String(params.id);
  if (idInvalido(targetId)) return json({ error: 'id-invalido' }, 400);
  if (targetId === admin.userId) return json({ error: 'no-permitido', detail: 'No podés eliminar tu propia cuenta desde acá.' }, 400);

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${targetId}`, { method: 'DELETE', headers: sbHeaders(env) });
  if (!res.ok && res.status !== 404) return json({ error: 'gotrue-error', detail: `No se pudo eliminar (HTTP ${res.status})` }, 502);

  await logAudit(env, { actorId: admin.userId, actorEmail: admin.email, action: 'eliminar', targetId });
  return json({ ok: true });
});
