-- Ledger de "cuánto del saldo disponible ya se invirtió" — el Stat "Disponible p/ invertir" en
-- Cobros era de solo lectura: los dividendos/intereses se van acumulando como 'disponible' (ver
-- 0011_cobros.sql), pero no había forma de marcar "de esos $X, ya invertí $Y" sin tener que tocar
-- filas individuales de cobros una por una (y casi nunca el monto exacto de UNA fila coincide con
-- lo que el usuario realmente puso a trabajar, porque junta varios dividendos chicos).
--
-- Diseño: una fila por cada vez que el usuario dice "invertí $X del saldo disponible" — no apunta
-- a ningún cobro puntual (no hace falta elegir cuáles filas "son" esos $X). El saldo neto se
-- calcula en el motor (engine/cobros.ts) como disponible - suma(cobros_inversiones.monto).

create table if not exists public.cobros_inversiones (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  fecha date not null,
  monto double precision not null check (monto > 0),
  nota text,
  created_at timestamptz not null default now()
);

create index if not exists cobros_inversiones_portfolio_idx on public.cobros_inversiones (portfolio_id, fecha desc);

alter table public.cobros_inversiones enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='cobros_inversiones' and policyname='cobros_inversiones_own') then
    create policy cobros_inversiones_own on public.cobros_inversiones for all to authenticated
      using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));
  end if;
end $$;
