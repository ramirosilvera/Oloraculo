-- ===========================================================================
-- Re-asegura las policies RLS (idempotente y auto-reparadora). Si alguna faltaba o
-- quedó mal, esto la deja correcta. Seguro de correr las veces que quieras.
-- Ejecutar en Supabase → SQL editor.
-- ===========================================================================

-- helper (por si no existe)
create or replace function public.owns_portfolio(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.portfolios p where p.id = pid and p.user_id = auth.uid());
$$;

-- Asegurar RLS habilitado
alter table public.profiles           enable row level security;
alter table public.portfolios         enable row level security;
alter table public.posiciones         enable row level security;
alter table public.aportes            enable row level security;
alter table public.cik_map            enable row level security;
alter table public.dcf_analisis       enable row level security;
alter table public.analisis_ia        enable row level security;
alter table public.fundamentals_cache enable row level security;
alter table public.precios_cache      enable row level security;
alter table public.macro_cache        enable row level security;

-- profiles / portfolios / cik_map → user_id = auth.uid()
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists portfolios_own on public.portfolios;
create policy portfolios_own on public.portfolios for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists cik_map_own on public.cik_map;
create policy cik_map_own on public.cik_map for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- posiciones / aportes / dcf_analisis / analisis_ia → vía owns_portfolio
drop policy if exists posiciones_own on public.posiciones;
create policy posiciones_own on public.posiciones for all to authenticated
  using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));

drop policy if exists aportes_own on public.aportes;
create policy aportes_own on public.aportes for all to authenticated
  using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));

drop policy if exists dcf_own on public.dcf_analisis;
create policy dcf_own on public.dcf_analisis for all to authenticated
  using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));

drop policy if exists ia_own on public.analisis_ia;
create policy ia_own on public.analisis_ia for all to authenticated
  using (portfolio_id is null or public.owns_portfolio(portfolio_id))
  with check (portfolio_id is null or public.owns_portfolio(portfolio_id));

-- caches de mercado → lectura para autenticados (escribe el service-role)
drop policy if exists fund_read on public.fundamentals_cache;
create policy fund_read on public.fundamentals_cache for select to authenticated using (true);

drop policy if exists precios_read on public.precios_cache;
create policy precios_read on public.precios_cache for select to authenticated using (true);

drop policy if exists macro_read on public.macro_cache;
create policy macro_read on public.macro_cache for select to authenticated using (true);
