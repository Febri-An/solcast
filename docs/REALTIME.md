# Realtime data layer

The UI never queries Solana RPC directly. Instead:

```
chain = settlement / verification
  DB  = mirror of chain (Supabase postgres)
  UI  = subscribes to DB via Supabase Realtime
```

Three things keep the DB in sync with chain:

1. **Write-through** from the Next.js app after every user-signed tx
   (`POST /api/markets/sync-one`, `POST /api/positions/sync-one`).
2. **Write-through** from the keeper after every `resolve_market` tx
   it submits (`upsertMarketRow` in `keeper/src/index.ts`).
3. **Full reconciliation** sweep — `keeper` runs `runCacheSyncOnce`
   every `KEEPER_CACHE_SYNC_INTERVAL_MS` ms (default 10 s) as a
   safety net for accounts changed by external clients / tx failures.

Frontend subscribes once per page:

- `useMarketsRealtime()` — list view (home).
- `useMarketRealtime(address)` — detail view (one market filter).
- `usePositionsRealtime(wallet)` — activity page.
- `useUserPositionRealtime(wallet, market)` — trade sidebar.

All four rely on the `supabase_realtime` publication and
`anon SELECT` policies created by migration `005_realtime_cache.sql`.

## Optimistic overlay

Right after the wallet signs a buy/sell, `use-market-trading` stores the
expected post-trade pool reserves (`quote.newYesShares / newNoShares`)
as an overlay, and renders them immediately. The overlay is cleared as
soon as the market prop changes identity (the realtime push landed) or
after a 6 s timeout.

The AMM math in `app/lib/amm-math.ts` mirrors `math.rs` on-chain byte-
for-byte so the optimistic estimate matches the confirmed state within
~1 lamport.

## Fallback path

If `NEXT_PUBLIC_SUPABASE_ANON_KEY` is not set in the browser, the hooks
silently fall back to polling `/api/markets`, `/api/positions` every
8 s (slow because it is a safety net, not a primary path).

## Applying migrations

```bash
# via Supabase CLI
supabase db push

# or paste each file in supabase/migrations/*.sql into the SQL editor
# dashboard -> SQL -> new query
```

After `005_realtime_cache.sql` is applied, verify in the Supabase
dashboard that `markets_cache` and `positions_cache` appear under
**Database -> Replication -> supabase_realtime** with at least
`INSERT/UPDATE/DELETE` checked.
