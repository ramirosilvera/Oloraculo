-- Supuestos de la Proyección guardados POR PORTFOLIO (no por usuario): el valor inicial de la
-- proyección (patrimonio de hoy) ya es del portfolio activo, así que el aporte anual, la tasa
-- esperada, el horizonte y la edad viajan junto a ese mismo portfolio.
-- inputs = { aporteAnual, tasaAnual, anios, edadInicial }.

create table if not exists public.proyeccion_inputs (
  portfolio_id uuid not null primary key references public.portfolios(id) on delete cascade,
  inputs jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.proyeccion_inputs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='proyeccion_inputs' and policyname='proyeccion_inputs_own') then
    create policy proyeccion_inputs_own on public.proyeccion_inputs for all to authenticated
      using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));
  end if;
end $$;
