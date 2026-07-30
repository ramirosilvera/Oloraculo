-- Brokers: dónde está físicamente cada posición (IOL, Santander, etc.). GLOBAL por usuario (no por
-- portfolio) — el mismo broker puede tener posiciones en varios portfolios a la vez, y así el
-- desglose por broker se puede consolidar entre portfolios sin duplicar el nombre en cada uno.

create table if not exists public.brokers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

-- Evita altas duplicadas ("Santander" / "santander ") — expresión, así que va como índice, no como
-- constraint de tabla (UNIQUE inline no admite lower()).
create unique index if not exists brokers_user_nombre_uidx on public.brokers (user_id, lower(nombre));

alter table public.brokers enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='brokers' and policyname='brokers_own') then
    create policy brokers_own on public.brokers for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- posiciones.broker_id: nullable — las posiciones existentes arrancan sin asignar, y una posición
-- cerrada (ya vendida) puede quedar así a propósito (no vale la pena etiquetarla retroactivo).
alter table public.posiciones add column if not exists broker_id uuid references public.brokers(id) on delete set null;
create index if not exists posiciones_broker_idx on public.posiciones (broker_id);

-- Defensa en profundidad: la FK por sí sola no garantiza que el broker_id pertenezca al MISMO
-- usuario dueño del portfolio de la posición (RLS de `brokers` ya lo impide para lecturas, pero un
-- INSERT/UPDATE directo con un id adivinado no queda cubierto solo por eso). Si algún día se agrega
-- un endpoint server-side con service-role que toque `posiciones` (como refresh-all.ts con cobros),
-- este trigger es la última línea de defensa contra mezclar brokers entre usuarios/portfolios —
-- misma lógica que la regla de oro #3 del proyecto (aislamiento entre portfolios).
create or replace function public.check_posicion_broker_ownership() returns trigger
language plpgsql security definer set search_path = public as $$
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

drop trigger if exists trg_posicion_broker_ownership on public.posiciones;
create trigger trg_posicion_broker_ownership
  before insert or update of broker_id, portfolio_id on public.posiciones
  for each row execute function public.check_posicion_broker_ownership();
