-- Make markets_cache and positions_cache browser-readable + enable realtime
-- push so the frontend can subscribe to changes instead of polling the API.
--
-- Writes are still restricted to the service role (Next.js server + keeper).
-- Reads are safe to expose to anon: bytes mirror on-chain accounts, which
-- are already public data on Solana.

-- ---------------------------------------------------------------------------
-- markets_cache: allow anon/authenticated SELECT, keep writes service-only.
-- ---------------------------------------------------------------------------

drop policy if exists "markets_cache_no_anon" on public.markets_cache;
drop policy if exists "markets_cache_no_authenticated" on public.markets_cache;

create policy "markets_cache_read_anon"
  on public.markets_cache
  for select
  to anon
  using (true);

create policy "markets_cache_read_authenticated"
  on public.markets_cache
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- positions_cache: same treatment.
-- ---------------------------------------------------------------------------

drop policy if exists "positions_cache_no_anon" on public.positions_cache;
drop policy if exists "positions_cache_no_authenticated" on public.positions_cache;

create policy "positions_cache_read_anon"
  on public.positions_cache
  for select
  to anon
  using (true);

create policy "positions_cache_read_authenticated"
  on public.positions_cache
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Realtime publication: add both cache tables so Supabase pushes INSERT /
-- UPDATE / DELETE events to subscribed clients.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'markets_cache'
  ) then
    alter publication supabase_realtime add table public.markets_cache;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'positions_cache'
  ) then
    alter publication supabase_realtime add table public.positions_cache;
  end if;
end $$;

-- Ensure DELETE events carry full row data so clients know which row vanished.
alter table public.markets_cache replica identity full;
alter table public.positions_cache replica identity full;
