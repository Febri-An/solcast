import { NextResponse } from "next/server";

import { syncMarketsCache } from "@/app/lib/markets-cache";
import { syncPositionsCache } from "@/app/lib/positions-cache";
import { SOLANA_RPC_URL } from "@/app/lib/solana-rpc";
import { createServiceSupabase, isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/markets/sync
 * Refreshes both `markets_cache` and `positions_cache` from chain.
 * Intended for cron, keeper, or manual runs.
 *
 * Authorization: if `MARKETS_SYNC_SECRET` is set, require `Authorization: Bearer <secret>`.
 */
export async function POST(request: Request) {
  const secret = process.env.MARKETS_SYNC_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  try {
    const supabase = createServiceSupabase();
    const markets = await syncMarketsCache(supabase, SOLANA_RPC_URL);
    const positions = await syncPositionsCache(supabase, SOLANA_RPC_URL);
    return NextResponse.json({ ok: true, markets, positions });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    console.error("[api/markets/sync]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
