-- Cached Market accounts (raw chain data). Populated by POST /api/markets/sync or `npm run markets:sync`.
-- The app reads via Next.js API (service role); browsers do not query this table directly.

create table if not exists public.markets_cache (
  address text primary key,
  account_data_base64 text not null,
  updated_at timestamptz not null default now()
);

create index if not exists markets_cache_updated_at on public.markets_cache (updated_at desc);

alter table public.markets_cache enable row level security;

-- No client-side access; Next.js API uses the service role (bypasses RLS).
create policy "markets_cache_no_anon"
  on public.markets_cache
  for all
  to anon
  using (false)
  with check (false);

create policy "markets_cache_no_authenticated"
  on public.markets_cache
  for all
  to authenticated
  using (false)
  with check (false);
