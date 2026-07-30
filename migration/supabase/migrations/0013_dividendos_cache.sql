-- Cache COMPARTIDO (no por usuario) del calendario de dividendos por ticker, igual criterio que
-- precios_cache/fundamentals_cache: es dato de mercado público, re-descargable, no personal.

create table if not exists public.dividendos_cache (
  ticker text primary key,
  data_json jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.dividendos_cache enable row level security;

-- Solo LECTURA para el cliente (igual que fundamentals_cache/precios_cache/macro_cache) — la
-- escritura la hace la Function con la service-role key (bypassa RLS), nunca el navegador
-- directo. Sin política de escritura para `authenticated` a propósito.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='dividendos_cache' and policyname='dividendos_cache_read') then
    create policy dividendos_cache_read on public.dividendos_cache for select to authenticated using (true);
  end if;
end $$;
