-- Dashboard personalizable: layout de tarjetas (agregar/quitar/reordenar secciones existentes +
-- construir tarjetas atómicas eligiendo una métrica del catálogo + un tipo de visualización — ver
-- engine/dashboardCatalog.ts). Es UNA fila JSONB por usuario (no una fila por tarjeta): el array
-- completo se reemplaza en cada guardado, evitando cualquier carrera de "sembrar el layout default
-- la primera vez" (sin fila = el cliente renderiza DEFAULT_LAYOUT desde código, sin escribir nada).
-- Global por usuario (no por portfolio): es una preferencia de CÓMO ver el dashboard, no un dato
-- financiero — mismo criterio que "Liquidez & FCI", ya documentado como compartido entre portfolios.

create table if not exists public.dashboard_layout (
  user_id uuid primary key references auth.users(id) on delete cascade,
  widgets jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_layout enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'dashboard_layout' and policyname = 'dashboard_layout_own') then
    create policy dashboard_layout_own on public.dashboard_layout for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
