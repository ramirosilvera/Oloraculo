-- ===========================================================================
-- Seed inicial del portfolio "Ahorros" (datos de la planilla original).
-- USO: 1) registrate en la app (Supabase Auth) con tu email.
--      2) reemplazá :owner_email abajo por ese email.
--      3) corré este script en el SQL editor de Supabase (o vía MCP).
-- Es idempotente: si el portfolio "Ahorros" ya existe, no lo duplica.
-- ===========================================================================

do $$
declare
  v_user uuid;
  v_pf   uuid;
begin
  select id into v_user from auth.users where email = :'owner_email';
  if v_user is null then raise exception 'No existe usuario con ese email — registrate primero'; end if;

  select id into v_pf from public.portfolios where user_id = v_user and nombre = 'Ahorros' limit 1;
  if v_pf is null then
    insert into public.portfolios (user_id, nombre, descripcion, moneda_ref)
    values (v_user, 'Ahorros', 'Producto de ingresos laborales', 'USD')
    returning id into v_pf;
  end if;

  -- CEDEARs (ticker, empresa, sector, rol, cantidad, precio_compra, ratio, peso_objetivo, tir_esperada)
  insert into public.posiciones (portfolio_id, tipo, ticker, sector, rol, cantidad, precio_compra, ratio_cedear, peso_objetivo, tir_esperada) values
    (v_pf,'cedear','UNH','Salud','stalwart',157,9.94910828,33,0.25,0.11),
    (v_pf,'cedear','MA','Finanzas','stalwart',47,15.9412766,33,0.20,0.10),
    (v_pf,'cedear','MSFT','Tecnología','stalwart',0,0,30,0.00,0.10),
    (v_pf,'cedear','GOOGL','Tecnología','stalwart',518,2.858624595,58,0.15,0.09),
    (v_pf,'cedear','MRK','Salud','stalwart',71,16.45985915,5,0.15,0.11),
    (v_pf,'cedear','MELI','Consumo discrecional','fast_grower',80,17.28,120,0.15,0.15),
    (v_pf,'cedear','LAC','Materiales','asset_play',265,3.168566038,1,0.10,0.20)
  on conflict do nothing;

  -- Bono real YM41D (1848 nominales, capital 1848, cupón trimestral 1.5%)
  insert into public.posiciones (portfolio_id, tipo, ticker, sector, cantidad, precio_compra, notas) values
    (v_pf,'bono','YM41D','Renta fija ARG',1848,1.0,'Cupón trimestral 1.5% (ene/abr/jul/oct)')
  on conflict do nothing;

  raise notice 'Seed "Ahorros" listo (portfolio %).', v_pf;
end $$;
