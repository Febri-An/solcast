"use client";

import type { Address } from "@solana/kit";

import { decodeMarketRow, fetchMarketFromRpc } from "./markets-cache";
import { SOLANA_RPC_URL } from "./solana-rpc";

/** Single confirmed account read — avoids stale props when quoting right before submit. */
export async function fetchMarketReservesConfirmed(
  marketAddress: string | Address,
): Promise<{ yesShares: bigint; noShares: bigint; feeBps: number } | null> {
  const addr = typeof marketAddress === "string" ? marketAddress : String(marketAddress);
  const row = await fetchMarketFromRpc(SOLANA_RPC_URL, addr);
  if (!row) return null;
  const { market } = decodeMarketRow(row);
  return {
    yesShares: market.yesShares,
    noShares: market.noShares,
    feeBps: market.feeBps,
  };
}
