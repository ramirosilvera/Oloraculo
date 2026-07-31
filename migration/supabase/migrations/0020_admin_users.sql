-- ===========================================================================
-- Sección Admin: alta/baja de usuarios, banear/reactivar, otorgar/revocar admin.
--
-- admin_users y admin_audit_log son de uso EXCLUSIVO del service-role (Pages Functions): RLS
-- habilitada y CERO políticas para authenticated/anon — ni siquiera el propio usuario puede leer
-- o escribir su propia fila desde el cliente. El estado de admin nunca se expone directo vía
-- PostgREST; solo se lee/escribe desde /api/admin/* después de re-verificar el JWT del que llama
-- y su membresía en admin_users con el service-role. Evita el error clásico de "guardar el rol en
-- una tabla que el cliente puede tocar" (mass-assignment → escalamiento de privilegios).
-- ===========================================================================

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

create table if not exists public.admin_audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users(id) on delete set null,
  actor_email  text,
  action       text not null,   -- crear_usuario | banear | reactivar | eliminar | otorgar_admin | revocar_admin
  target_id    uuid references auth.users(id) on delete set null,
  target_email text,
  detalle      jsonb,
  created_at   timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
create index if not exists admin_audit_log_created_idx on public.admin_audit_log(created_at desc);

-- No son datos de un portfolio ni de un usuario individual — son estado global de administración.
-- A propósito NO se agregan a backup.ts/restore.ts (ver TABLAS en src/lib/backup.ts): un backup es
-- per-usuario y restaurable por su dueño; si admin_users viajara en un backup, restaurarlo en otra
-- cuenta sería una vía de escalamiento de privilegios.

-- Bootstrap: deja al usuario actual como primer admin. Si el email todavía no existe (orden de
-- despliegue), no falla — el insert simplemente no encuentra filas y no hace nada.
insert into public.admin_users (user_id)
select id from auth.users where email = 'ra1990@hotmail.com'
on conflict (user_id) do nothing;
