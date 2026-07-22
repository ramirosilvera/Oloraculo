-- Supuestos del DCF guardados POR USUARIO Y TICKER (no por portfolio): así el Radar (watchlist
-- a nivel usuario) y el Análisis usan los mismos supuestos y el score refleja lo que el usuario
-- ajustó. inputs = { g, d, gt, N, capexMethod, mosRequired, beta }.

create table if not exists public.dcf_inputs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null,
  inputs jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table public.dcf_inputs enable row level security;

drop policy if exists dcf_inputs_own on public.dcf_inputs;
create policy dcf_inputs_own on public.dcf_inputs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
