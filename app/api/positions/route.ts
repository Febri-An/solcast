import { NextResponse } from "next/server";

import { readMarketsCache } from "@/app/lib/markets-cache";
import { readPositionsForUser } from "@/app/lib/positions-cache";
import { createServiceSupabase, isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/positions?wallet=<address>&market=<address>
 *
 * Read-only from `positions_cache` and `markets_cache` in Supabase.
 * Positions appear after successful trades via POST /api/positions/sync-one
 * (write-through). No RPC fallback and no bulk sync from chain.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  const marketFilter = url.searchParams.get("market") ?? undefined;
  if (!wallet) {
    return NextResponse.json({ error: "wallet query param required" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  try {
    const supabase = createServiceSupabase();
    const positions = await readPositionsForUser(supabase, wallet, marketFilter);

    const markets = await readMarketsCache(supabase);
    const relevantMarkets = markets.filter((m) =>
      positions.some((p) => p.marketAddress === m.address),
    );

    const marketsJson = relevantMarkets.map((m) => ({
      address: m.address,
      accountDataBase64: m.accountDataBase64,
      vaultLamports:
        m.vaultLamports === undefined || m.vaultLamports === null
          ? null
          : m.vaultLamports.toString(),
    }));

    return NextResponse.json({
      source: "cache",
      positions,
      markets: marketsJson,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load positions from cache";
    console.error("[api/positions] cache error:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
