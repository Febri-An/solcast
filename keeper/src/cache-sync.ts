/**
 * Keeper-embedded cache sync.
 *
 * Piggybacks on the keeper process so we do not need a separate cron/Vercel
 * deployment for a no-op health tick. Bulk cache sync from chain is disabled;
 * aligns with POST /api/markets/sync returning skipped for markets + positions.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export async function runCacheSyncOnce(): Promise<{
  markets: { skipped: true; reason: "market_full_sync_disabled" };
  positions: { skipped: true; reason: "positions_full_sync_disabled" };
  durationMs: number;
}> {
  const start = Date.now();
  const markets = { skipped: true as const, reason: "market_full_sync_disabled" as const };
  const positions = {
    skipped: true as const,
    reason: "positions_full_sync_disabled" as const,
  };
  return { markets, positions, durationMs: Date.now() - start };
}
