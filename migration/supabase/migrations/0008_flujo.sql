-- =============================================================================
-- 0008 — Flujo de caja personal (ingresos / egresos / inversiones tipo Excel).
-- Es del USUARIO, no de un portfolio (un sueldo alimenta a todos los portfolios),
-- así que se aísla por user_id = auth.uid() como profiles / cik_map.
-- =============================================================================

create table if not exists public.flujo_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  categoria  text not null,                      -- 'ingreso' | 'egreso' | 'inversion'
  concepto   text not null default '',           -- etiqueta editable ("Sueldo", "Tarjeta Visa", "FCI Mercado Pago")
  monto      double precision not null default 0,
  moneda     text not null default 'ARS',        -- 'ARS' | 'USD'
  destino    text,                               -- solo inversión: 'fci' | 'mercadopago' | 'cedears' | 'bonos' | 'efectivo' | 'otro'
  orden      integer not null default 0,         -- orden dentro de su categoría
  activo     boolean not null default true,      -- filas desactivadas no suman (pero se conservan)
  nota       text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists flujo_items_user_idx on public.flujo_items(user_id, categoria, orden);

alter table public.flujo_items enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='flujo_items' and policyname='flujo_own') then
    create policy flujo_own on public.flujo_items for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
