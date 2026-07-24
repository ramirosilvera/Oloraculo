-- =============================================================================
-- 0009 — Snapshots diarios del valor del portfolio, para el rendimiento por año calendario
-- (como los fondos). Se registran de acá en adelante (una fila por portfolio y día).
-- =============================================================================

create table if not exists public.portfolio_snapshots (
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  fecha        date not null,
  valor        double precision not null,           -- valor de mercado del portfolio ese día (USD)
  aportado     double precision not null default 0, -- capital aportado NETO acumulado a esa fecha (USD)
  created_at   timestamptz not null default now(),
  primary key (portfolio_id, fecha)
);

create index if not exists snapshots_portfolio_idx on public.portfolio_snapshots(portfolio_id, fecha);

alter table public.portfolio_snapshots enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='portfolio_snapshots' and policyname='snapshots_own') then
    create policy snapshots_own on public.portfolio_snapshots for all to authenticated
      using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));
  end if;
end $$;
