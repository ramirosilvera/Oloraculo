-- Cronograma de cuotas de amortización FUTURAS, cargado a mano por el usuario — no hay ninguna
-- fuente automática que lo publique (ni data912, ver sesión que agregó 0027_bond_amortizable.sql).
-- Cada fila es una cuota ESPERADA: % del nominal ORIGINAL que se amortiza en esa fecha. Se usa
-- SOLO para proyectar (engine/coupons.ts: couponEvents/capitalEvents) — no reemplaza a
-- posiciones.valor_residual, que sigue siendo la foto de HOY (se actualiza vía
-- useCobros.ts#registrarAmortizacionVR cuando la cuota realmente se cobra). Mismo patrón de RLS
-- que posicion_brokers (0018): ownership vía join a posiciones -> owns_portfolio().

create table if not exists public.amortizaciones_programadas (
  id uuid primary key default gen_random_uuid(),
  posicion_id uuid not null references public.posiciones(id) on delete cascade,
  fecha date not null,
  porcentaje numeric not null check (porcentaje > 0 and porcentaje <= 1),
  created_at timestamptz not null default now()
);

create unique index if not exists amortizaciones_programadas_pos_fecha_uidx on public.amortizaciones_programadas (posicion_id, fecha);
create index if not exists amortizaciones_programadas_posicion_idx on public.amortizaciones_programadas (posicion_id);

alter table public.amortizaciones_programadas enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'amortizaciones_programadas' and policyname = 'amortizaciones_programadas_own') then
    create policy amortizaciones_programadas_own on public.amortizaciones_programadas for all to authenticated
      using (exists (select 1 from public.posiciones p where p.id = posicion_id and public.owns_portfolio(p.portfolio_id)))
      with check (exists (select 1 from public.posiciones p where p.id = posicion_id and public.owns_portfolio(p.portfolio_id)));
  end if;
end $$;

comment on table public.amortizaciones_programadas is 'Cronograma manual de cuotas de amortización FUTURAS de un bono — usado solo para proyectar (Cupones), no para la valuación actual (esa usa posiciones.valor_residual).';
comment on column public.amortizaciones_programadas.porcentaje is 'Fracción (0..1] del nominal original que se espera amortizar en esta fecha — un valor por cuota, no un acumulado.';
