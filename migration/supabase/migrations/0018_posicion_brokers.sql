-- Reemplaza posiciones.broker_id (0016) por una tabla de ASIGNACIÓN posición↔broker↔cantidad.
-- Motivo: `posiciones.broker_id` obligaba a duplicar la FILA cuando un ticker estaba repartido
-- entre dos brokers (ej. mitad en IOL, mitad en Santander) — eso rompió cotizaciones (el ticker
-- duplicado hacía fallar el upsert de precios_cache en batch) y complicaba P&L/rebalanceo/cupones.
-- Ahora `posiciones` vuelve a ser 1 fila por ticker por portfolio; el reparto entre brokers vive
-- acá, y se muestra en la sección Brokers (no en Posiciones).
--
-- Orden importante: hay que DROPEAR el trigger viejo (0017, sobre posiciones.broker_id) ANTES de
-- redefinir la función que usa — si no, las UPDATE de posiciones de más abajo (el merge) disparan
-- el trigger viejo ejecutando la función YA redefinida (que espera NEW.posicion_id, columna que no
-- existe en posiciones) y revientan con un error de columna inexistente.

-- 1) Tabla nueva, sin trigger todavía (se agrega al final, después del backfill/merge).
create table if not exists public.posicion_brokers (
  id uuid primary key default gen_random_uuid(),
  posicion_id uuid not null references public.posiciones(id) on delete cascade,
  broker_id uuid not null references public.brokers(id) on delete cascade,
  cantidad double precision not null check (cantidad > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists posicion_brokers_pos_broker_uidx on public.posicion_brokers (posicion_id, broker_id);
create index if not exists posicion_brokers_posicion_idx on public.posicion_brokers (posicion_id);

alter table public.posicion_brokers enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='posicion_brokers' and policyname='posicion_brokers_own') then
    create policy posicion_brokers_own on public.posicion_brokers for all to authenticated
      using (exists (select 1 from public.posiciones p where p.id = posicion_id and public.owns_portfolio(p.portfolio_id)))
      with check (exists (select 1 from public.posiciones p where p.id = posicion_id and public.owns_portfolio(p.portfolio_id)));
  end if;
end $$;

-- 2) Backfill: cada posición con broker_id hoy pasa a una fila en posicion_brokers con TODA su
-- cantidad actual (incluidas las 3 posiciones que estaban partidas — sus dos mitades quedan acá
-- apuntando, por ahora, cada una a su propia posicion_id todavía existente).
insert into public.posicion_brokers (posicion_id, broker_id, cantidad)
select id, broker_id, cantidad from public.posiciones where broker_id is not null;

-- 3) Reapuntar las asignaciones de las 3 filas "nuevas" (creadas al partir MELI/LAC/UNH en Ahorros)
-- a la posición ORIGINAL que va a sobrevivir al merge.
update public.posicion_brokers set posicion_id = 'fc101987-91ba-4727-b6dc-469e2e71f9b0' where posicion_id = '391755b8-c54a-4731-b956-65a08ab98fff'; -- MELI
update public.posicion_brokers set posicion_id = '84826ef2-d80f-412d-80ed-ddac5e3b4f94' where posicion_id = '08ef3999-9148-4e5e-b7b4-6eb4855a0648'; -- LAC
update public.posicion_brokers set posicion_id = '5f78f361-ed57-49c2-a07c-020b0a25658a' where posicion_id = '76c261ee-4078-4f6a-9cc7-7d43169b2167'; -- UNH

-- 4) Unificar: la fila original recupera la cantidad TOTAL (verificado: 0 movimientos y 0 cobros en
-- las 6 filas involucradas, no hay historial que reapuntar ni riesgo de duplicar un cobro del cron).
update public.posiciones set cantidad = 80 where id = 'fc101987-91ba-4727-b6dc-469e2e71f9b0';  -- MELI 69+11
update public.posiciones set cantidad = 265 where id = '84826ef2-d80f-412d-80ed-ddac5e3b4f94'; -- LAC 63+202
update public.posiciones set cantidad = 157 where id = '5f78f361-ed57-49c2-a07c-020b0a25658a'; -- UNH 44+113

-- 5) Borrar las filas "nuevas" ya obsoletas.
delete from public.posiciones where id in (
  '391755b8-c54a-4731-b956-65a08ab98fff', '08ef3999-9148-4e5e-b7b4-6eb4855a0648', '76c261ee-4078-4f6a-9cc7-7d43169b2167'
);

-- 6) Recién ahora: sacar el trigger/columna viejos de `posiciones` (0016/0017).
drop trigger if exists trg_posicion_broker_ownership on public.posiciones;
alter table public.posiciones drop column if exists broker_id;

-- 7) Redefinir la función de validación de dueño para el nuevo esquema (posicion_brokers en vez de
-- posiciones.broker_id) y crear el trigger nuevo — recién acá, con el viejo ya desactivado.
create or replace function public.check_posicion_broker_ownership() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (
    select 1 from public.posiciones pos
    join public.portfolios port on port.id = pos.portfolio_id
    join public.brokers b on b.id = new.broker_id
    where pos.id = new.posicion_id and b.user_id = port.user_id
  ) then
    raise exception 'broker_id no pertenece al dueño de la posición';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_posicion_broker_ownership on public.posicion_brokers;
create trigger trg_posicion_broker_ownership
  before insert or update of posicion_id, broker_id on public.posicion_brokers
  for each row execute function public.check_posicion_broker_ownership();
