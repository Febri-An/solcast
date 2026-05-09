/**
 * Previously: bulk refresh Supabase caches from RPC.
 *
 * Full sync is disabled — use POST /api/markets/sync-one and POST /api/positions/sync-one
 * after confirmed transactions (or Keeper auto-resolve writes for resolved markets).
 */

console.error(
  "[markets-sync] Full cache sync from chain is disabled (markets_cache + positions_cache).",
);
console.error(
  "[markets-sync] Use sync-one endpoints after txs, or run keeper for auto-resolve only.",
);
process.exit(1);
