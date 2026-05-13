import { NextResponse } from "next/server";

import { type Address } from "@solana/kit";

import { getUserPositionDecoder } from "@/app/generated/prediction_market/accounts/userPosition";
import { deriveUserPositionAddress } from "@/app/lib/program-pda";
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

async function fetchAccountBase64(
  rpcUrl: string,
  address: string,
  commitment: "confirmed" | "finalized" = "confirmed",
): Promise<string | null> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [address, { encoding: "base64", commitment }],
    }),
  });
  const result = (await response.json()) as {
    error?: { message: string };
    result?: { value: { data: [string, string] } | null };
  };
  if (result.error) throw new Error(result.error.message);
  return result.result?.value?.data?.[0] ?? null;
}

/**
 * POST /api/positions/sync-one
 * Body: { wallet: string, market: string }
 *
 * Fetches the UserPosition PDA derived from (market, user), decodes it,
 * and upserts it into `positions_cache`. If RPC cannot read the account
 * after retries, returns 503 and **does not** delete existing cache rows
 * (avoids false "settled" UI after a transient RPC miss).
 *
 * Called by the frontend after a buy / sell / redeem succeeds so the
 * user's position in Supabase matches the chain within ~500 ms.
 */
export async function POST(request: Request) {
  let wallet: string | undefined;
  let market: string | undefined;
  try {
    const body = (await request.json()) as { wallet?: string; market?: string };
    wallet = body.wallet?.trim();
    market = body.market?.trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!wallet || !market) {
    return NextResponse.json(
      { error: "wallet and market are required" },
      { status: 400 },
    );
  }

  try {
    const positionAddress = await deriveUserPositionAddress(
      market as Address,
      wallet as Address,
    );
    console.log(
      `[api/positions/sync-one] start market=${market} wallet=${wallet} pda=${positionAddress}`,
    );

    let b64 = await fetchAccountBase64(SOLANA_RPC_URL, positionAddress, "confirmed");
    console.log(
      `[api/positions/sync-one] attempt=0 pda=${positionAddress} found=${Boolean(b64)}`,
    );
    for (const delayMs of RETRY_DELAYS_MS) {
      if (b64) break;
      await sleep(delayMs);
      b64 = await fetchAccountBase64(SOLANA_RPC_URL, positionAddress, "confirmed");
      console.log(
        `[api/positions/sync-one] retry delay_ms=${delayMs} pda=${positionAddress} found=${Boolean(b64)}`,
      );
    }
    if (!b64) {
      b64 = await fetchAccountBase64(SOLANA_RPC_URL, positionAddress, "finalized");
      console.log(
        `[api/positions/sync-one] finalized attempt=0 pda=${positionAddress} found=${Boolean(b64)}`,
      );
      for (const delayMs of RETRY_DELAYS_MS) {
        if (b64) break;
        await sleep(delayMs);
        b64 = await fetchAccountBase64(SOLANA_RPC_URL, positionAddress, "finalized");
        console.log(
          `[api/positions/sync-one] finalized retry delay_ms=${delayMs} pda=${positionAddress} found=${Boolean(b64)}`,
        );
      }
    }

    if (!b64) {
      // Do **not** delete `positions_cache` here. A transient RPC miss after a
      // successful redeem used to wipe the row and made the UI show "settled"
      // while lamports had not moved yet (or the user still had redeemable shares).
      console.warn(
        `[api/positions/sync-one] account fetch still null after retries pda=${positionAddress} — leaving cache unchanged`,
      );
      return NextResponse.json(
        {
          ok: false,
          error: "position_account_unavailable",
          address: positionAddress,
        },
        { status: 503 },
      );
    }

    // Decode to validate + denormalize market/user for filtered queries.
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const decoded = getUserPositionDecoder().decode(bytes);

    // Defensive sanity check: decoded account should match the requested pair.
    if (decoded.market !== market || decoded.user !== wallet) {
      return NextResponse.json(
        { error: "Decoded position does not match requested wallet/market" },
        { status: 500 },
      );
    }

    if (isSupabaseConfigured()) {
      const supabase = createServiceSupabase();
      const { error } = await supabase.from("positions_cache").upsert(
        {
          address: positionAddress,
          market_address: market,
          user_address: wallet,
          account_data_base64: b64,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "address" },
      );
      if (error) throw error;
      console.log(
        `[api/positions/sync-one] upserted pda=${positionAddress} market=${market}`,
      );
    } else {
      console.warn(
        `[api/positions/sync-one] supabase not configured, skip upsert pda=${positionAddress}`,
      );
    }

    return NextResponse.json({
      ok: true,
      position: {
        address: positionAddress,
        marketAddress: market,
        userAddress: wallet,
        accountDataBase64: b64,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    console.error("[api/positions/sync-one]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
