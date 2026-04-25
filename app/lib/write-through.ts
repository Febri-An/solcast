"use client";

/**
 * Client-side helpers for the "write-through" cache pattern:
 * after a transaction confirms, ask the API to fetch the single affected
 * account from RPC and upsert it into Supabase. Realtime subscribers
 * then receive the UPDATE within ~100 ms.
 *
 * All calls are fire-and-forget from a correctness perspective — if the
 * sync fails for any reason, the keeper's full reconciliation cycle will
 * catch up within a few seconds. We still await so the caller can choose
 * to `void` them or show a spinner.
 */

export async function syncMarketRow(address: string): Promise<void> {
  try {
    await fetch("/api/markets/sync-one", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
  } catch (err) {
    console.warn("[write-through] market sync-one failed:", err);
  }
}

export async function syncPositionRow(
  wallet: string,
  market: string,
): Promise<void> {
  try {
    await fetch("/api/positions/sync-one", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, market }),
    });
  } catch (err) {
    console.warn("[write-through] position sync-one failed:", err);
  }
}

/** Convenience: run both market + position sync-ones in parallel. */
export async function syncMarketAndPosition(
  marketAddress: string,
  walletAddress: string,
): Promise<void> {
  await Promise.all([
    syncMarketRow(marketAddress),
    syncPositionRow(walletAddress, marketAddress),
  ]);
}
