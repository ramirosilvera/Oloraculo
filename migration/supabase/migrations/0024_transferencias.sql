-- ===========================================================================
-- Transferencias: mover una posición (o parte) de un portfolio propio a otro, preservando
-- EXACTAMENTE precio_compra y fecha_compra (reclasificación contable, no una venta/recompra a
-- precio de mercado). No toca movimientos/pnl.ts (no es un evento de venta) ni aportes/TIR (no es
-- capital externo). El registro de la transferencia vive en esta tabla — no hace falta tocar
-- movimientos para tener un historial.
--
-- Todo el movimiento (restar en origen + insertar en destino + loguear) pasa por
-- transferir_posicion(), una única función atómica — así nunca queda a mitad de camino (origen
-- reducido pero destino sin crear) si algo falla en el medio.
-- ===========================================================================

create table if not exists public.transferencias (
  id                   uuid primary key default gen_random_uuid(),
  portfolio_origen_id  uuid not null references public.portfolios(id) on delete cascade,
  portfolio_destino_id uuid not null references public.portfolios(id) on delete cascade,
  posicion_origen_id   uuid not null references public.posiciones(id) on delete cascade,
  posicion_destino_id  uuid references public.posiciones(id) on delete set null,
  ticker               text not null,
  tipo                 text not null,
  cantidad             double precision not null,
  precio_compra        double precision not null,   -- costo por unidad transferida, preservado tal cual
  fecha_compra         date,
  nota                 text,
  created_at           timestamptz not null default now()
);
alter table public.transferencias enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='transferencias' and policyname='transferencias_select') then
    create policy transferencias_select on public.transferencias for select to authenticated
      using (public.owns_portfolio(portfolio_origen_id) or public.owns_portfolio(portfolio_destino_id));
  end if;
end $$;
-- A propósito SIN policy de insert/update/delete para el cliente: la única vía de escritura es
-- transferir_posicion() (security definer, valida ambos portfolios ella misma).

create or replace function public.transferir_posicion(
  p_posicion_id uuid, p_portfolio_destino uuid, p_cantidad double precision, p_nota text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pos public.posiciones%rowtype;
  v_destino_existente uuid;
  v_nueva_id uuid;
  v_transferencia_id uuid;
begin
  select * into v_pos from public.posiciones where id = p_posicion_id;
  if not found then raise exception 'Posición no encontrada'; end if;
  -- security definer bypasa RLS: sin este chequeo, cualquiera podría mover la posición de OTRO
  -- usuario pasando su id. owns_portfolio() ya es la misma función que protege el resto del schema.
  if not public.owns_portfolio(v_pos.portfolio_id) then raise exception 'No tenés esa posición'; end if;
  if not public.owns_portfolio(p_portfolio_destino) then raise exception 'El portfolio destino no es tuyo'; end if;
  if v_pos.portfolio_id = p_portfolio_destino then raise exception 'El origen y el destino no pueden ser el mismo portfolio'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor a 0'; end if;
  if p_cantidad > v_pos.cantidad then raise exception 'No podés transferir más de lo que tenés (%)', v_pos.cantidad; end if;

  -- Si el destino YA tiene una posición abierta del mismo ticker/tipo, consolidar mezclaría el
  -- costo (promedio ponderado) y se perdería el precio_compra/fecha_compra exactos que pide la
  -- reclasificación contable — mejor rechazar con un mensaje claro que auto-mezclar en silencio.
  select id into v_destino_existente from public.posiciones
    where portfolio_id = p_portfolio_destino and ticker = v_pos.ticker and tipo = v_pos.tipo and cantidad > 0
    limit 1;
  if v_destino_existente is not null then
    raise exception 'El portfolio destino ya tiene una posición abierta de % — transferí manualmente para no mezclar el costo', v_pos.ticker;
  end if;

  update public.posiciones set cantidad = cantidad - p_cantidad where id = p_posicion_id;

  insert into public.posiciones (portfolio_id, tipo, ticker, empresa, sector, rol, cantidad, precio_compra,
    fecha_compra, peso_objetivo, ratio_cedear, tir_esperada, beta, notas)
  values (p_portfolio_destino, v_pos.tipo, v_pos.ticker, v_pos.empresa, v_pos.sector, v_pos.rol, p_cantidad,
    v_pos.precio_compra, v_pos.fecha_compra, null, v_pos.ratio_cedear, v_pos.tir_esperada, v_pos.beta, v_pos.notas)
  returning id into v_nueva_id;

  insert into public.transferencias (portfolio_origen_id, portfolio_destino_id, posicion_origen_id,
    posicion_destino_id, ticker, tipo, cantidad, precio_compra, fecha_compra, nota)
  values (v_pos.portfolio_id, p_portfolio_destino, p_posicion_id, v_nueva_id, v_pos.ticker, v_pos.tipo,
    p_cantidad, v_pos.precio_compra, v_pos.fecha_compra, p_nota)
  returning id into v_transferencia_id;

  return v_transferencia_id;
end;
$$;

revoke all on function public.transferir_posicion(uuid, uuid, double precision, text) from public;
grant execute on function public.transferir_posicion(uuid, uuid, double precision, text) to authenticated;
