-- Point-in-time implied YES probability for charts (derived when markets_cache updates).

create table if not exists public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  market_address text not null,
  recorded_at timestamptz not null default now(),
  yes_bps integer not null check (yes_bps >= 0 and yes_bps <= 10000),
  -- Lamports-scale pool depth (yes_shares + no_shares); stored as text for full u128/u64 sums.
  total_pool text not null
);

create index if not exists market_snapshots_market_time
  on public.market_snapshots (market_address, recorded_at desc);

alter table public.market_snapshots enable row level security;

-- Writes via service role only; browsers load history through Next.js API.
create policy "market_snapshots_no_anon"
  on public.market_snapshots
  for all
  to anon
  using (false)
  with check (false);

create policy "market_snapshots_no_authenticated"
  on public.market_snapshots
  for all
  to authenticated
  using (false)
  with check (false);
