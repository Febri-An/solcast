import { NextResponse } from "next/server";

import {
  fetchMarketFromRpc,
  upsertMarketRow,
} from "@/app/lib/markets-cache";
import { SOLANA_RPC_URL } from "@/app/lib/solana-rpc";
import {
  createServiceSupabase,
  isSupabaseConfigured,
} from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";
const RETRY_DELAYS_MS = [200, 400, 800, 1200];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST /api/markets/sync-one
 * Body: { address: string }
 *
 * Fetches a single Market account from Solana RPC and upserts it into the
 * Supabase cache. Used as a "write-through" after the frontend lands a
 * transaction that mutates the account (create, buy, sell, resolve).
 *
 * Keeping the round-trip small means the UI gets the chain-truth snapshot
 * in ~200–500 ms after confirmation, without waiting for the keeper's
 * full-sync cycle. Realtime subscribers are then pushed the UPDATE event.
 */
export async function POST(request: Request) {
  let address: string | undefined;
  try {
    const body = (await request.json()) as { address?: string };
    address = body.address?.trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  try {
    console.log(`[api/markets/sync-one] start address=${address}`);

    let row = await fetchMarketFromRpc(SOLANA_RPC_URL, address);
    console.log(
      `[api/markets/sync-one] attempt=0 address=${address} found=${Boolean(row)}`,
    );
    for (const delayMs of RETRY_DELAYS_MS) {
      if (row) break;
      await sleep(delayMs);
      row = await fetchMarketFromRpc(SOLANA_RPC_URL, address);
      console.log(
        `[api/markets/sync-one] retry delay_ms=${delayMs} address=${address} found=${Boolean(row)}`,
      );
    }

    if (!row) {
      console.warn(
        `[api/markets/sync-one] not found after retries address=${address}`,
      );
      return NextResponse.json(
        {
          ok: false,
          reason: "not_found_after_retry",
          address,
          retries: RETRY_DELAYS_MS.length,
        },
        { status: 404 },
      );
    }

    if (isSupabaseConfigured()) {
      const supabase = createServiceSupabase();
      await upsertMarketRow(supabase, row);
      console.log(`[api/markets/sync-one] upserted address=${address}`);
    } else {
      console.warn(
        `[api/markets/sync-one] supabase not configured, skip upsert address=${address}`,
      );
    }

    return NextResponse.json({
      ok: true,
      market: {
        address: row.address,
        accountDataBase64: row.accountDataBase64,
        vaultLamports: row.vaultLamports?.toString() ?? null,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    console.error("[api/markets/sync-one]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
