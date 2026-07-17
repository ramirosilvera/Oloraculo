-- ===========================================================================
-- Base de ratios de CEDEARs (subyacentes por CEDEAR, BYMA). Se usa para pre-llenar
-- el ratio al cargar una posición CEDEAR. Es una base EDITABLE y compartida (lectura
-- para autenticados); la escribe el usuario desde la app o el service-role.
-- ⚠️ Los ratios pueden cambiar (splits/ajustes BYMA) — verificalos; el campo es editable.
-- ===========================================================================

create table if not exists public.cedear_ratios (
  ticker     text primary key,
  ratio      double precision not null,
  updated_at timestamptz not null default now()
);

alter table public.cedear_ratios enable row level security;

do $$ begin
  -- lectura para cualquier autenticado
  if not exists (select 1 from pg_policies where tablename='cedear_ratios' and policyname='cedear_ratios_read') then
    create policy cedear_ratios_read on public.cedear_ratios for select to authenticated using (true);
  end if;
  -- alta/edición para autenticados (base colaborativa de un solo usuario)
  if not exists (select 1 from pg_policies where tablename='cedear_ratios' and policyname='cedear_ratios_write') then
    create policy cedear_ratios_write on public.cedear_ratios for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Seed. Los 7 primeros están verificados (de tu planilla); el resto son valores de
-- referencia comunes de BYMA — verificá y corregí desde la app si hace falta.
insert into public.cedear_ratios (ticker, ratio) values
  ('UNH',33),('MA',33),('MSFT',30),('GOOGL',58),('MRK',5),('MELI',120),('LAC',1),
  ('AAPL',20),('AMZN',20),('META',24),('NVDA',24),('TSLA',15),('NFLX',16),('AMD',20),
  ('INTC',7),('KO',5),('PEP',9),('V',19),('JPM',15),('BAC',6),('WMT',24),('DIS',9),
  ('NKE',10),('PG',15),('JNJ',15),('PFE',6),('MCD',30),('XOM',6),('CVX',12),('BABA',9),
  ('T',3),('VZ',6),('C',4),('BA',12),('IBM',20),('ORCL',12),('CSCO',8),('ADBE',18),
  ('PYPL',12),('QCOM',6),('AMGN',30),('ABBV',12),('COST',40),('SBUX',12),('GE',12)
on conflict (ticker) do nothing;
