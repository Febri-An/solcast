import { NextResponse } from "next/server";

import { fetchMarketsFromRpc, readMarketsCache } from "@/app/lib/markets-cache";
import {
  fetchPositionsFromRpc,
  readPositionsForUser,
  syncPositionsCache,
} from "@/app/lib/positions-cache";
import { SOLANA_RPC_URL } from "@/app/lib/solana-rpc";
import { createServiceSupabase, isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/positions?wallet=<address>&market=<address>
 *
 * Returns the user's UserPosition rows (optionally filtered to a single
 * market) plus the Market accounts referenced by those positions so the UI
 * can render with one roundtrip. Falls back to Solana RPC if Supabase is
 * not configured or unavailable.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  const marketFilter = url.searchParams.get("market") ?? undefined;
  if (!wallet) {
    return NextResponse.json({ error: "wallet query param required" }, { status: 400 });
  }

  const useCache = isSupabaseConfigured();

  try {
    if (useCache) {
      const supabase = createServiceSupabase();
      let positions = await readPositionsForUser(supabase, wallet, marketFilter);

      if (positions.length === 0 && !marketFilter) {
        await syncPositionsCache(supabase, SOLANA_RPC_URL);
        positions = await readPositionsForUser(supabase, wallet);
      }

      const markets = await readMarketsCache(supabase);
      const relevantMarkets = markets.filter((m) =>
        positions.some((p) => p.marketAddress === m.address),
      );

      return NextResponse.json({
        source: "cache",
        positions,
        markets: relevantMarkets,
      });
    }
  } catch (e) {
    console.error("[api/positions] cache error, falling back to RPC:", e);
  }

  try {
    const all = await fetchPositionsFromRpc(SOLANA_RPC_URL);
    const positions = all.filter(
      (p) => p.userAddress === wallet && (!marketFilter || p.marketAddress === marketFilter),
    );
    const wantMarkets = new Set(positions.map((p) => p.marketAddress));
    const markets = (await fetchMarketsFromRpc(SOLANA_RPC_URL)).filter((m) =>
      wantMarkets.has(m.address),
    );
    return NextResponse.json({ source: "rpc", positions, markets });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load positions";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
