-- El upsert genérico de PostgREST (sbUpsert/on_conflict=col1,col2) NO puede apuntar a un ÍNDICE
-- PARCIAL como cobros_cron_dedupe (posicion_id,tipo,fecha WHERE origen='cron'): Postgres exige que
-- el ON CONFLICT repita el WHERE del índice, y PostgREST no expone esa opción. Esta función sí
-- puede escribirlo completo — la usa el cron (functions/api/cron/refresh-all.ts) para insertar
-- cobros 'pendiente' de forma idempotente sin pisar uno que el usuario ya haya confirmado/editado.
--
-- security invoker (no definer): solo la llama service_role, que ya bypassea RLS por su cuenta —
-- no hace falta escalar privilegios, y así no se suma otro warning de "SECURITY DEFINER público"
-- como el que ya tiene owns_portfolio.

create or replace function public.insertar_cobro_pendiente_cron(
  p_portfolio_id uuid, p_posicion_id uuid, p_ticker text, p_tipo text,
  p_fecha date, p_monto double precision, p_nota text
) returns void
language sql security invoker set search_path = public as $$
  insert into public.cobros (portfolio_id, posicion_id, ticker, tipo, fecha, monto, estado, origen, nota)
  values (p_portfolio_id, p_posicion_id, p_ticker, p_tipo, p_fecha, p_monto, 'pendiente', 'cron', p_nota)
  on conflict (posicion_id, tipo, fecha) where origen = 'cron' do nothing;
$$;

-- Solo service_role: esta función inserta cobros para CUALQUIER portfolio_id/posicion_id que se le
-- pase — si un usuario autenticado pudiera llamarla directo, sería una vía de contaminación entre
-- portfolios (la regla de oro #3 del proyecto).
revoke all on function public.insertar_cobro_pendiente_cron from public, anon, authenticated;
grant execute on function public.insertar_cobro_pendiente_cron to service_role;
