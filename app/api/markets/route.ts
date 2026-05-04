import { NextResponse } from "next/server";

import { fetchMarketsFromRpc, readMarketsCache, syncMarketsCache } from "@/app/lib/markets-cache";
import { SOLANA_RPC_URL } from "@/app/lib/solana-rpc";
import { createServiceSupabase, isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets
 * - If Supabase is configured: read `markets_cache` (bootstrap from RPC once if empty).
 * - Otherwise: fetch directly from Solana RPC (same as before, but server-side only).
 */
export async function GET() {
  const rpcUrl = SOLANA_RPC_URL;

  if (!isSupabaseConfigured()) {
    try {
      const markets = await fetchMarketsFromRpc(rpcUrl);
      return NextResponse.json({ source: "rpc", markets });
    } catch (e) {
      const message = e instanceof Error ? e.message : "RPC fetch failed";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  try {
    const supabase = createServiceSupabase();
    let rows = await readMarketsCache(supabase);

    if (rows.length === 0) {
      await syncMarketsCache(supabase, rpcUrl);
      rows = await readMarketsCache(supabase);
    }

    return NextResponse.json(
      { source: "cache", markets: rows },
      {
        headers: {
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      },
    );
  } catch (e) {
    console.error("[api/markets] cache error, falling back to RPC:", e);
    try {
      const markets = await fetchMarketsFromRpc(rpcUrl);
      return NextResponse.json({
        source: "rpc",
        markets,
        warning: "cache_unavailable",
      });
    } catch (e2) {
      const message = e2 instanceof Error ? e2.message : "Failed to load markets";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
}
