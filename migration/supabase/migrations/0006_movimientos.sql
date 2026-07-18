-- Historial de movimientos por activo. Al agregar una posición de un activo ya existente en el
-- mismo portfolio, la posición se CONSOLIDA (cantidad + costo promedio ponderado) y cada compra
-- queda registrada acá como un movimiento, para tener el registro completo de lo actuado.

create table if not exists public.movimientos (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  posicion_id uuid references public.posiciones(id) on delete cascade,
  ticker text not null,
  tipo text not null default 'compra',   -- 'compra' | 'venta' | 'ajuste'
  cantidad numeric not null,
  precio numeric not null,               -- precio por unidad (USD) del movimiento
  fecha date not null default current_date,
  nota text,
  created_at timestamptz not null default now()
);

create index if not exists movimientos_portfolio_idx on public.movimientos (portfolio_id);
create index if not exists movimientos_posicion_idx on public.movimientos (posicion_id);

alter table public.movimientos enable row level security;

drop policy if exists movimientos_own on public.movimientos;
create policy movimientos_own on public.movimientos for all to authenticated
  using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));
