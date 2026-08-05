-- ===========================================================================
-- Beta de mercado por ticker, cacheado — dato REAL de una API de mercado (Finnhub/FMP), nunca
-- generado por un LLM (ver CLAUDE.md regla de oro #1). Reemplaza el default fijo de 1.0 que
-- usaba WACC/DCF cuando el usuario no cargó un beta manual en Análisis. Mismo patrón que
-- precios_cache: dato compartido y re-descargable, no personal — se excluye del backup a propósito
-- (ver TABLAS en src/lib/backup.ts).
-- ===========================================================================

create table if not exists public.beta_cache (
  ticker     text primary key,
  beta       double precision,
  fuente     text,             -- 'finnhub' | 'fmp' — de dónde salió, para transparencia
  updated_at timestamptz not null default now()
);
alter table public.beta_cache enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='beta_cache' and policyname='beta_read') then
    create policy beta_read on public.beta_cache for select to authenticated using (true);
  end if;
end $$;
