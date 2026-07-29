-- Cobros REALES (no proyectados) de dividendos, intereses y amortizaciones de capital, por
-- posición. Antes de esto no había ningún registro persistido de plata efectivamente cobrada —
-- Cupones solo proyectaba hacia adelante desde la tasa de cupón guardada en `posiciones`.
--
-- 'amortizacion' es devolución de CAPITAL, no renta: reduce el nominal tenido (posiciones.cantidad)
-- vía un movimiento 'ajuste' (mismo camino ya usado para splits/correcciones — no toca el costo
-- promedio, ver engine/tenencia.ts). 'dividendo'/'interes' son renta pura y no tocan la posición.

create table if not exists public.cobros (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  -- set null (no cascade): si se borra la posición, el registro histórico de lo cobrado se
  -- conserva (el ticker queda igual, desnormalizado, como en movimientos).
  posicion_id uuid references public.posiciones(id) on delete set null,
  ticker text not null,
  tipo text not null check (tipo in ('dividendo', 'interes', 'amortizacion')),
  fecha date not null default current_date,
  monto double precision not null check (monto > 0),
  estado text not null default 'disponible' check (estado in ('disponible', 'reinvertido')),
  -- Solo para amortizaciones: el movimiento 'ajuste' que redujo el nominal. Si ese movimiento se
  -- borra (deshacer la amortización) desde el historial de Posiciones, este campo queda en null.
  movimiento_id uuid references public.movimientos(id) on delete set null,
  nota text,
  created_at timestamptz not null default now()
);

create index if not exists cobros_portfolio_idx on public.cobros (portfolio_id, fecha);
create index if not exists cobros_posicion_idx on public.cobros (posicion_id);

alter table public.cobros enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='cobros' and policyname='cobros_own') then
    create policy cobros_own on public.cobros for all to authenticated
      using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));
  end if;
end $$;
