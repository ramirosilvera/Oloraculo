-- Hardening tras revisión de código de la feature de cobros pendientes:
--
-- 1) insertar_cobro_pendiente_cron ahora valida que la posición pertenezca al portfolio antes de
--    insertar. Corre como service_role (bypassa RLS) — sin este chequeo, un bug en el código que
--    la llama (functions/api/cron/refresh-all.ts) podría escribir un cobro en el portfolio
--    equivocado sin que nada lo impida (regla de oro #3: aislamiento entre portfolios). Si el par
--    portfolio_id/posicion_id no coincide con una fila real, el SELECT no devuelve nada y el
--    INSERT queda en cero filas — falla en silencio hacia el lado seguro, no hacia el inseguro.
--
-- 2) Nuevo estado 'descartado': antes, "Descartar" una sugerencia BORRABA la fila, lo que también
--    borraba la única marca de "esto ya se sugirió" (la clave del índice cobros_cron_dedupe) — el
--    cron la volvía a sugerir en la próxima corrida (cada 30 min), indefinidamente, para un cupón
--    de bono mal cargado o un dividendo que se repite en la ventana de 7 días. 'descartado' deja la
--    fila (así el dedupe sigue funcionando) pero la excluye de resumenCobros, igual que 'pendiente'.

create or replace function public.insertar_cobro_pendiente_cron(
  p_portfolio_id uuid, p_posicion_id uuid, p_ticker text, p_tipo text,
  p_fecha date, p_monto double precision, p_nota text
) returns void
language sql security invoker set search_path = public as $$
  insert into public.cobros (portfolio_id, posicion_id, ticker, tipo, fecha, monto, estado, origen, nota)
  select p_portfolio_id, p.id, p_ticker, p_tipo, p_fecha, p_monto, 'pendiente', 'cron', p_nota
  from public.posiciones p
  where p.id = p_posicion_id and p.portfolio_id = p_portfolio_id
  on conflict (posicion_id, tipo, fecha) where origen = 'cron' do nothing;
$$;

alter table public.cobros drop constraint if exists cobros_estado_check;
alter table public.cobros add constraint cobros_estado_check check (estado in ('disponible', 'reinvertido', 'pendiente', 'descartado'));
