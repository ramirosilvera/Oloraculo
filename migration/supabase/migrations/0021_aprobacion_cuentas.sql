-- ===========================================================================
-- Aprobación de cuentas: el auto-registro sigue abierto (LoginPage), pero una cuenta nueva no
-- puede crear NINGÚN portfolio hasta que un admin la apruebe desde /admin. Mismo patrón que
-- admin_users (0020): RLS habilitada, CERO políticas para authenticated/anon — la aprobación
-- nunca se expone ni se puede tocar desde el cliente, solo server-side (service-role) en
-- /api/admin/*. Sin esto, "aprobar" viviría como una columna en una tabla que el cliente puede
-- tocar (profiles), y un self-signup podría aprobarse a sí mismo con un simple UPDATE.
-- ===========================================================================

create table if not exists public.usuarios_aprobados (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  aprobado_por uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.usuarios_aprobados enable row level security;

-- Admin ⇒ aprobado automáticamente (no hace falta estar en las dos tablas a la vez).
create or replace function public.is_approved(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users a where a.user_id = uid)
      or exists (select 1 from public.usuarios_aprobados u where u.user_id = uid);
$$;

-- portfolios_own (0001_portfolio_schema.sql) era una sola policy "for all" con el chequeo de
-- dueño. Se separa por comando para poder exigir aprobación SOLO al crear (insert) — leer/editar/
-- borrar lo propio sigue exactamente igual que antes; esto nunca le saca acceso a datos ya
-- existentes, solo bloquea crear el primer portfolio hasta que un admin apruebe la cuenta.
drop policy if exists portfolios_own on public.portfolios;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='portfolios' and policyname='portfolios_select') then
    create policy portfolios_select on public.portfolios for select to authenticated
      using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='portfolios' and policyname='portfolios_insert') then
    create policy portfolios_insert on public.portfolios for insert to authenticated
      with check (user_id = auth.uid() and public.is_approved(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='portfolios' and policyname='portfolios_update') then
    create policy portfolios_update on public.portfolios for update to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='portfolios' and policyname='portfolios_delete') then
    create policy portfolios_delete on public.portfolios for delete to authenticated
      using (user_id = auth.uid());
  end if;
end $$;
