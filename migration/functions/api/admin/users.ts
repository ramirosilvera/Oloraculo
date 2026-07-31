// Panel admin — listar usuarios (GET) y dar de alta (POST). Todo pasa por requireAdmin(): sesión
// válida + membresía en admin_users, re-verificada acá con el service-role en cada request, nunca
// confiando en el estado del cliente. La fuente de la verdad de "qué usuarios existen" es GoTrue
// (auth.users vía Admin Auth API), no una tabla propia — evita que el panel se desincronice de la
// realidad de Supabase Auth.
import { type Env, json, preflight, guard, sbHeaders, sbSelect, sbUpsert } from '../_shared';
import { requireAdmin, logAudit } from './_guard';
import { armarUsuarios, type GoTrueAdminUser } from './_merge';

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet = guard(async ({ request, env }) => {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'no-autorizado', detail: 'Necesitás ser administrador.' }, 403);

  const [gotrueRes, adminRows, profileRows, portfolioRows] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: sbHeaders(env) }),
    sbSelect<{ user_id: string }>(env, 'admin_users', 'select=user_id'),
    sbSelect<{ user_id: string; display_name: string | null }>(env, 'profiles', 'select=user_id,display_name'),
    sbSelect<{ user_id: string }>(env, 'portfolios', 'select=user_id'),
  ]);
  if (!gotrueRes.ok) return json({ error: 'gotrue-error', detail: `No se pudo listar usuarios (HTTP ${gotrueRes.status})` }, 502);
  const body = await gotrueRes.json() as { users?: GoTrueAdminUser[] } | GoTrueAdminUser[];
  const gotrueUsers = Array.isArray(body) ? body : (body.users ?? []);

  const portfolioCounts = new Map<string, number>();
  for (const p of portfolioRows) portfolioCounts.set(p.user_id, (portfolioCounts.get(p.user_id) ?? 0) + 1);
  const displayNames = new Map(profileRows.map(p => [p.user_id, p.display_name]));
  const adminIds = new Set(adminRows.map(r => r.user_id));

  const users = armarUsuarios(gotrueUsers, adminIds, displayNames, portfolioCounts, new Date().toISOString());
  return json({ users, total: users.length });
});

// Alta admin-provisionada: el admin fija un email + contraseña inicial (se la pasa al usuario por
// fuera de la app) y opcionalmente un nombre. email_confirm:true → puede loguearse de inmediato,
// sin depender de que el proyecto tenga SMTP configurado para mandar un mail de confirmación.
export const onRequestPost = guard(async ({ request, env }) => {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'no-autorizado', detail: 'Necesitás ser administrador.' }, 403);

  let body: { email?: string; password?: string; displayName?: string };
  try { body = await request.json(); } catch { return json({ error: 'body-invalido' }, 400); }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const displayName = (body.displayName || '').trim() || null;
  if (!email || !email.includes('@')) return json({ error: 'email-invalido', detail: 'Ingresá un email válido.' }, 400);
  if (password.length < 8) return json({ error: 'password-invalido', detail: 'La contraseña necesita al menos 8 caracteres.' }, 400);

  const createRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: sbHeaders(env),
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: displayName ? { display_name: displayName } : undefined }),
  });
  const created = await createRes.json() as { id?: string; email?: string; msg?: string; message?: string; error_description?: string };
  if (!createRes.ok || !created.id) {
    const detail = created.msg || created.message || created.error_description || `HTTP ${createRes.status}`;
    return json({ error: 'crear-usuario', detail }, createRes.status === 422 ? 409 : 502);
  }

  if (displayName) await sbUpsert(env, 'profiles', [{ user_id: created.id, display_name: displayName }], 'user_id');
  await logAudit(env, { actorId: admin.userId, actorEmail: admin.email, action: 'crear_usuario', targetId: created.id, targetEmail: email });

  return json({ user: { id: created.id, email: created.email ?? email, displayName } }, 201);
});
