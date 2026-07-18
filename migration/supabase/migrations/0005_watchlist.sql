-- Watchlist / Radar: tickers en seguimiento del usuario (research, no tenencia).
-- Aislada por usuario vía RLS (auth.uid()), independiente de los portfolios.

create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null,
  cik text,
  nota text,
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

alter table watchlist enable row level security;

drop policy if exists watchlist_own on watchlist;
create policy watchlist_own on watchlist
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
