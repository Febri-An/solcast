/**
 * Keeper-embedded cache sync.
 *
 * Piggybacks on the keeper process so we do not need a separate cron/Vercel
 * deployment. Reuses the exact same sync logic the `/api/markets/sync` route
 * calls, so there is a single source of truth.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { syncMarketsCache } from "../../app/lib/markets-cache";
import { syncPositionsCache } from "../../app/lib/positions-cache";

export type CacheSyncConfig = {
  enabled: boolean;
  intervalMs: number;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  rpcUrl: string;
};

export function makeSupabaseClient(
  supabaseUrl: string,
  serviceRoleKey: string,
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function runCacheSyncOnce(
  supabase: SupabaseClient,
  rpcUrl: string,
): Promise<{ markets: { upserted: number; deleted: number }; positions: { upserted: number; deleted: number }; durationMs: number }> {
  const start = Date.now();
  const markets = await syncMarketsCache(supabase, rpcUrl);
  const positions = await syncPositionsCache(supabase, rpcUrl);
  return { markets, positions, durationMs: Date.now() - start };
}
