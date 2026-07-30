-- El trigger de 0016 quedó como SECURITY DEFINER sin necesidad (el advisor de seguridad lo marcó:
-- función ejecutable públicamente vía RPC). No hace falta: el RLS de `brokers`/`portfolios` ya
-- filtra por el usuario que llama, así que con SECURITY INVOKER (default) el `not exists` da el
-- mismo resultado — si el usuario referencia un broker_id ajeno, RLS ya se lo esconde en la
-- subconsulta, y el trigger igual la rechaza explícito en vez de dejarla colgada en silencio.

create or replace function public.check_posicion_broker_ownership() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.broker_id is not null then
    if not exists (
      select 1 from public.brokers b join public.portfolios p on p.id = new.portfolio_id
      where b.id = new.broker_id and b.user_id = p.user_id
    ) then
      raise exception 'broker_id no pertenece al dueño de este portfolio';
    end if;
  end if;
  return new;
end;
$$;
