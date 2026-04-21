-- Cached UserPosition accounts. Populated by POST /api/markets/sync or `npm run markets:sync`.
-- Same pattern as markets_cache: store raw account bytes + denormalize owner/market for filtering.

create table if not exists public.positions_cache (
  address text primary key,
  market_address text not null,
  user_address text not null,
  account_data_base64 text not null,
  updated_at timestamptz not null default now()
);

create index if not exists positions_cache_user on public.positions_cache (user_address);
create index if not exists positions_cache_market on public.positions_cache (market_address);

alter table public.positions_cache enable row level security;

create policy "positions_cache_no_anon"
  on public.positions_cache
  for all
  to anon
  using (false)
  with check (false);

create policy "positions_cache_no_authenticated"
  on public.positions_cache
  for all
  to authenticated
  using (false)
  with check (false);
