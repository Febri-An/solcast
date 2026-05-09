import { NextResponse } from "next/server";

import {
  fetchMarketFromRpc,
  readMarketFromCache,
  upsertMarketRow,
} from "@/app/lib/markets-cache";
import { type RpcMarketRow } from "@/app/lib/markets-cache";
import { SOLANA_RPC_URL } from "@/app/lib/solana-rpc";
import { createServiceSupabase, isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

function jsonMarketRow(row: RpcMarketRow) {
  return {
    address: row.address,
    accountDataBase64: row.accountDataBase64,
    vaultLamports: row.vaultLamports?.toString() ?? null,
  };
}

/**
 * GET /api/markets/[address]
 * Returns a single Market account. Reads from Supabase cache when available;
 * bootstraps the row from RPC when missing and then caches it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = createServiceSupabase();
      let row = await readMarketFromCache(supabase, address);
      if (!row) {
        row = await fetchMarketFromRpc(SOLANA_RPC_URL, address);
        if (row) {
          await upsertMarketRow(supabase, row).catch(() => {});
        }
      }
      if (!row) {
        return NextResponse.json({ error: "Market not found" }, { status: 404 });
      }
      return NextResponse.json({ source: "cache", market: jsonMarketRow(row) });
    } catch (e) {
      console.error("[api/markets/[address]] cache error, falling back to RPC:", e);
    }
  }

  try {
    const row = await fetchMarketFromRpc(SOLANA_RPC_URL, address);
    if (!row) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }
    return NextResponse.json({ source: "rpc", market: jsonMarketRow(row) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load market";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
