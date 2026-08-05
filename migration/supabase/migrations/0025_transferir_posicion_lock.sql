-- ===========================================================================
-- Fix: transferir_posicion() leía la posición sin bloquearla (sin FOR UPDATE). Dos llamadas
-- concurrentes (doble click, dos pestañas) podían leer el mismo cantidad "vigente" antes de que
-- cualquiera de las dos escribiera, pasar la validación de "no podés transferir más de lo que
-- tenés" cada una por separado, y dejar la posición de origen en cantidad NEGATIVA (vendida de más
-- sin que ninguna validación lo detectara). SELECT ... FOR UPDATE serializa: la segunda llamada
-- concurrente espera a que la primera termine (commit) y relee el cantidad ya actualizado.
-- ===========================================================================

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
  select * into v_pos from public.posiciones where id = p_posicion_id for update;
  if not found then raise exception 'Posición no encontrada'; end if;
  if not public.owns_portfolio(v_pos.portfolio_id) then raise exception 'No tenés esa posición'; end if;
  if not public.owns_portfolio(p_portfolio_destino) then raise exception 'El portfolio destino no es tuyo'; end if;
  if v_pos.portfolio_id = p_portfolio_destino then raise exception 'El origen y el destino no pueden ser el mismo portfolio'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor a 0'; end if;
  if p_cantidad > v_pos.cantidad then raise exception 'No podés transferir más de lo que tenés (%)', v_pos.cantidad; end if;

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
