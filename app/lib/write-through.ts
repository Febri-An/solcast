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

export async function syncMarketRow(address: string): Promise<boolean> {
  try {
    const res = await fetch("/api/markets/sync-one", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) {
      console.warn("[write-through] market sync-one HTTP", res.status);
      return false;
    }
    const body = (await res.json()) as { ok?: boolean };
    return body.ok !== false;
  } catch (err) {
    console.warn("[write-through] market sync-one failed:", err);
    return false;
  }
}

export async function syncPositionRow(
  wallet: string,
  market: string,
): Promise<boolean> {
  try {
    const res = await fetch("/api/positions/sync-one", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, market }),
    });
    if (!res.ok) {
      console.warn("[write-through] position sync-one HTTP", res.status);
      return false;
    }
    const body = (await res.json()) as { ok?: boolean };
    return body.ok !== false;
  } catch (err) {
    console.warn("[write-through] position sync-one failed:", err);
    return false;
  }
}

/** Convenience: run both market + position sync-ones in parallel. */
export async function syncMarketAndPosition(
  marketAddress: string,
  walletAddress: string,
): Promise<{ marketOk: boolean; positionOk: boolean }> {
  const [marketOk, positionOk] = await Promise.all([
    syncMarketRow(marketAddress),
    syncPositionRow(walletAddress, marketAddress),
  ]);
  return { marketOk, positionOk };
}

const POSITION_CACHE_REFRESH_BACKOFF_MS = [0, 280, 650, 1200] as const;

/** Sync RPC → Supabase, then retry `refresh` (read path can briefly lag write-through). */
export async function syncPositionCacheAfterTx(
  marketAddress: string,
  walletAddress: string,
  refresh: () => Promise<void>,
): Promise<{ marketOk: boolean; positionOk: boolean }> {
  const { marketOk, positionOk } = await syncMarketAndPosition(marketAddress, walletAddress);
  for (const delayMs of POSITION_CACHE_REFRESH_BACKOFF_MS) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    await refresh();
  }
  return { marketOk, positionOk };
}

export interface PositionFillInput {
  clientFillId: string;
  txSignature?: string;
  instructionIndex?: number;
  wallet: string;
  market: string;
  side: "buy_yes" | "buy_no" | "sell_yes" | "sell_no";
  sharesDelta: bigint;
  lamportsDelta: bigint;
  feeLamports?: bigint;
}

export async function recordPositionFill(input: PositionFillInput): Promise<void> {
  try {
    await fetch("/api/positions/record-fill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientFillId: input.clientFillId,
        txSignature: input.txSignature,
        instructionIndex: input.instructionIndex ?? 0,
        wallet: input.wallet,
        market: input.market,
        side: input.side,
        sharesDelta: input.sharesDelta.toString(),
        lamportsDelta: input.lamportsDelta.toString(),
        feeLamports: (input.feeLamports ?? 0n).toString(),
      }),
    });
  } catch (err) {
    console.warn("[write-through] position fill record failed:", err);
  }
}

export interface PositionMetricsSnapshot {
  wallet: string;
  market_address: string;
  yes_open_shares: string;
  no_open_shares: string;
  yes_cost_basis_lamports: string;
  no_cost_basis_lamports: string;
  realized_pnl_lamports: string;
  updated_at: string;
}

export async function fetchPositionMetrics(
  wallet: string,
  market: string,
): Promise<PositionMetricsSnapshot | null> {
  try {
    const response = await fetch(
      `/api/positions/metrics?wallet=${encodeURIComponent(wallet)}&market=${encodeURIComponent(market)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { metrics?: PositionMetricsSnapshot | null };
    return payload.metrics ?? null;
  } catch (err) {
    console.warn("[write-through] fetch position metrics failed:", err);
    return null;
  }
}
