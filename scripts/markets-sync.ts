/**
 * Refresh Supabase `markets_cache` from Solana RPC.
 * Usage: npm run markets:sync
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SOLANA_RPC_URL
 */

import "dotenv/config";

import { syncMarketsCache } from "../app/lib/markets-cache";
import { syncPositionsCache } from "../app/lib/positions-cache";
import { SOLANA_RPC_URL } from "../app/lib/solana-rpc";
import { createServiceSupabase, isSupabaseConfigured } from "../app/lib/supabase/server";

async function main() {
  if (!isSupabaseConfigured()) {
    console.error("Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createServiceSupabase();
  const markets = await syncMarketsCache(supabase, SOLANA_RPC_URL);
  console.log(`markets_cache synced: upserted=${markets.upserted}, deleted=${markets.deleted}`);
  const positions = await syncPositionsCache(supabase, SOLANA_RPC_URL);
  console.log(`positions_cache synced: upserted=${positions.upserted}, deleted=${positions.deleted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
