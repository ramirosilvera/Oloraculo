-- ===========================================================================
-- Portfolio de Inversiones — esquema multi-portfolio con RLS por usuario.
-- Aislamiento total: las posiciones/aportes/análisis de un portfolio nunca se
-- mezclan con los de otro, y todo cuelga de auth.uid().
-- ===========================================================================

create extension if not exists pgcrypto;

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ── portfolios ──────────────────────────────────────────────────────────────
create table if not exists public.portfolios (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  nombre           text not null,
  descripcion      text,
  capital_objetivo double precision,
  moneda_ref       text not null default 'USD',
  estrategia       text,
  estado           text not null default 'active',   -- active | archived
  created_at       timestamptz not null default now()
);
create index if not exists portfolios_user_idx on public.portfolios(user_id);

-- ── posiciones ──────────────────────────────────────────────────────────────
create table if not exists public.posiciones (
  id            uuid primary key default gen_random_uuid(),
  portfolio_id  uuid not null references public.portfolios(id) on delete cascade,
  tipo          text not null,                 -- cedear | bono | etf | cash
  ticker        text not null,
  empresa       text,
  sector        text,
  rol           text,                          -- compounder | stalwart | fast_grower | asset_play | ...
  cantidad      double precision not null default 0,
  precio_compra double precision not null default 0,
  fecha_compra  date,
  peso_objetivo double precision,              -- 0..1
  ratio_cedear  double precision,
  tir_esperada  double precision,
  beta          double precision,
  notas         text,
  created_at    timestamptz not null default now()
);
create index if not exists posiciones_portfolio_idx on public.posiciones(portfolio_id);

-- ── aportes (capital entrante) ───────────────────────────────────────────────
create table if not exists public.aportes (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  monto        double precision not null,
  fecha        date not null,
  tipo         text not null default 'recurrente',  -- inicial | adelanto | recurrente
  descripcion  text
);
create index if not exists aportes_portfolio_idx on public.aportes(portfolio_id);

-- ── cik_map (overrides/adds del usuario; los defaults viven en código) ────────
create table if not exists public.cik_map (
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker  text not null,
  cik     text not null,
  beta    double precision,
  primary key (user_id, ticker)
);

-- ── dcf_analisis (inputs + resultado; se recalcula, la fila es persistencia) ──
create table if not exists public.dcf_analisis (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references public.portfolios(id) on delete cascade,
  ticker         text not null,
  inputs_json    jsonb not null default '{}'::jsonb,
  resultado_json jsonb,
  updated_at     timestamptz not null default now(),
  unique (portfolio_id, ticker)
);

-- ── analisis_ia (cache de Gemini) ────────────────────────────────────────────
create table if not exists public.analisis_ia (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid references public.portfolios(id) on delete cascade,
  ticker       text,
  tipo         text not null,                  -- empresa | portfolio | noticia
  prompt       text,
  respuesta    text,
  modelo       text,
  input_hash   text,
  created_at   timestamptz not null default now()
);
create index if not exists analisis_ia_lookup_idx on public.analisis_ia(portfolio_id, ticker, tipo);

-- ── caches de mercado (datos compartidos, escritos por las Functions) ─────────
create table if not exists public.fundamentals_cache (
  ticker     text primary key,
  cik        text,
  data_json  jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.precios_cache (
  ticker     text primary key,
  precio     double precision,
  moneda     text default 'USD',
  updated_at timestamptz not null default now()
);
create table if not exists public.macro_cache (
  clave      text primary key,   -- dolar_mep, riesgo_pais, dgs10, dgs3mo, hy_spread, ...
  valor      double precision,
  data_json  jsonb,
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.profiles           enable row level security;
alter table public.portfolios         enable row level security;
alter table public.posiciones         enable row level security;
alter table public.aportes            enable row level security;
alter table public.cik_map            enable row level security;
alter table public.dcf_analisis       enable row level security;
alter table public.analisis_ia        enable row level security;
alter table public.fundamentals_cache enable row level security;
alter table public.precios_cache      enable row level security;
alter table public.macro_cache        enable row level security;

-- Helper: ¿el portfolio pertenece al usuario?
create or replace function public.owns_portfolio(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.portfolios p where p.id = pid and p.user_id = auth.uid());
$$;

-- profiles / portfolios / cik_map → user_id = auth.uid()
do $$ begin
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='profiles_own') then
    create policy profiles_own on public.profiles for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='portfolios' and policyname='portfolios_own') then
    create policy portfolios_own on public.portfolios for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='cik_map' and policyname='cik_map_own') then
    create policy cik_map_own on public.cik_map for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- posiciones / aportes / dcf_analisis / analisis_ia → vía owns_portfolio
do $$ begin
  if not exists (select 1 from pg_policies where tablename='posiciones' and policyname='posiciones_own') then
    create policy posiciones_own on public.posiciones for all to authenticated
      using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='aportes' and policyname='aportes_own') then
    create policy aportes_own on public.aportes for all to authenticated
      using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='dcf_analisis' and policyname='dcf_own') then
    create policy dcf_own on public.dcf_analisis for all to authenticated
      using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='analisis_ia' and policyname='ia_own') then
    create policy ia_own on public.analisis_ia for all to authenticated
      using (portfolio_id is null or public.owns_portfolio(portfolio_id))
      with check (portfolio_id is null or public.owns_portfolio(portfolio_id));
  end if;
end $$;

-- caches de mercado → cualquier usuario autenticado LEE; la escritura la hace el
-- service-role (Functions), que ignora RLS. Sin política de insert/update para el cliente.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='fundamentals_cache' and policyname='fund_read') then
    create policy fund_read on public.fundamentals_cache for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='precios_cache' and policyname='precios_read') then
    create policy precios_read on public.precios_cache for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='macro_cache' and policyname='macro_read') then
    create policy macro_read on public.macro_cache for select to authenticated using (true);
  end if;
end $$;
