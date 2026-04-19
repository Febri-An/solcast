"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { type Address } from "@solana/kit";

import {
  getMarketDecoder,
  type Market,
  PREDICTION_MARKET_PROGRAM_ADDRESS,
} from "../generated/prediction_market";
import {
  getUserPositionDecoder,
  type UserPosition,
} from "../generated/prediction_market/accounts/userPosition";
import { ActivityStats } from "./activity-stats";
import { SOLANA_RPC_URL } from "../lib/solana-rpc";
import { PositionCard } from "./position-card";

const USER_POSITION_DISCRIMINATOR_BASE58 = "j9SjDYAWesU";
const POLL_INTERVAL_MS = 3000;

interface PositionWithMarket {
  positionAddress: Address;
  position: UserPosition;
  marketAddress: Address;
  market: Market | null;
}

export interface ActivityStatsData {
  totalInvested: bigint;
  totalWon: bigint;
  totalClaimed: bigint;
  totalLost: bigint;
  roiPercent: number;
  activePositions: number;
  claimablePositions: number;
}

type FilterTab = "all" | "active" | "resolved" | "claimable";

interface PositionsListProps {
  walletAddress: Address;
}

export function PositionsList({ walletAddress }: PositionsListProps): ReactNode {
  const [positions, setPositions] = useState<PositionWithMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const fetchPositions = useCallback(async () => {
    if (!walletAddress) return;

    try {
      const positionsResponse = await fetch(SOLANA_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getProgramAccounts",
          params: [
            PREDICTION_MARKET_PROGRAM_ADDRESS,
            {
              encoding: "base64",
              commitment: "confirmed",
              filters: [
                {
                  memcmp: {
                    offset: 0,
                    bytes: USER_POSITION_DISCRIMINATOR_BASE58,
                  },
                },
                {
                  memcmp: {
                    offset: 40,
                    bytes: walletAddress,
                  },
                },
              ],
            },
          ],
        }),
      });

      const positionsResult = await positionsResponse.json();

      if (positionsResult.error) {
        throw new Error(positionsResult.error.message);
      }

      const positionDecoder = getUserPositionDecoder();
      const decodedPositions: Array<{ address: Address; position: UserPosition }> = [];

      for (const account of positionsResult.result || []) {
        try {
          const data = Uint8Array.from(atob(account.account.data[0]), (c) =>
            c.charCodeAt(0)
          );
          const position = positionDecoder.decode(data);
          decodedPositions.push({
            address: account.pubkey as Address,
            position,
          });
        } catch (decodeError) {
          console.warn("Failed to decode position:", account.pubkey, decodeError);
        }
      }

      const marketAddresses = [...new Set(decodedPositions.map((p) => p.position.market))];

      const marketMap = new Map<string, Market>();

      if (marketAddresses.length > 0) {
        const marketsResponse = await fetch(SOLANA_RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "getMultipleAccounts",
            params: [
              marketAddresses,
              { encoding: "base64", commitment: "confirmed" },
            ],
          }),
        });

        const marketsResult = await marketsResponse.json();
        const marketDecoder = getMarketDecoder();

        if (marketsResult.result?.value) {
          marketsResult.result.value.forEach(
            (account: { data: string[] } | null, index: number) => {
              if (account && account.data) {
                try {
                  const data = Uint8Array.from(atob(account.data[0]), (c) =>
                    c.charCodeAt(0)
                  );
                  const market = marketDecoder.decode(data);
                  marketMap.set(marketAddresses[index], market);
                } catch {
                  console.warn("Failed to decode market:", marketAddresses[index]);
                }
              }
            }
          );
        }
      }

      const enrichedPositions: PositionWithMarket[] = decodedPositions.map((p) => ({
        positionAddress: p.address,
        position: p.position,
        marketAddress: p.position.market,
        market: marketMap.get(p.position.market) || null,
      }));

      enrichedPositions.sort((a, b) => {
        const aTime = a.market?.resolutionTime ?? 0n;
        const bTime = b.market?.resolutionTime ?? 0n;
        return Number(bTime - aTime);
      });

      setPositions(enrichedPositions);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch positions:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch positions");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  const stats = useMemo((): ActivityStatsData => {
    let totalInvested = 0n;
    let totalWon = 0n;
    let totalClaimed = 0n;
    let totalLost = 0n;
    let activeCount = 0;
    let claimableCount = 0;

    for (const { position, market } of positions) {
      const invested = position.yesAmount + position.noAmount;
      totalInvested += invested;

      if (!market || !market.resolved) {
        activeCount++;
        continue;
      }

      const outcome = market.outcome;
      if (outcome === null || outcome === undefined) continue;

      const userWinningBet = outcome ? position.yesAmount : position.noAmount;
      const userLosingBet = outcome ? position.noAmount : position.yesAmount;

      if (userWinningBet > 0n) {
        const winningPool = outcome ? market.yesPool : market.noPool;
        const losingPool = outcome ? market.noPool : market.yesPool;
        const winnings = winningPool > 0n ? (userWinningBet * losingPool) / winningPool : 0n;
        const payout = userWinningBet + winnings;

        totalWon += winnings;
        totalLost += userLosingBet;

        if (position.claimed) {
          totalClaimed += payout;
        } else {
          claimableCount++;
        }
      } else {
        totalLost += invested;
      }
    }

    const netPnL = totalWon - totalLost;
    const roiPercent = totalInvested > 0n ? Number((netPnL * 10000n) / totalInvested) / 100 : 0;

    return {
      totalInvested,
      totalWon,
      totalClaimed,
      totalLost,
      roiPercent,
      activePositions: activeCount,
      claimablePositions: claimableCount,
    };
  }, [positions]);

  const filteredPositions = useMemo(() => {
    return positions.filter(({ position, market }) => {
      if (activeTab === "all") return true;
      if (activeTab === "active") return !market?.resolved;
      if (activeTab === "resolved") return market?.resolved;

      if (!market?.resolved || position.claimed) return false;
      const outcome = market.outcome;
      if (outcome === null || outcome === undefined) return false;
      const userWinningBet = outcome ? position.yesAmount : position.noAmount;
      return userWinningBet > 0n;
    });
  }, [positions, activeTab]);

  const tabCounts = useMemo(() => {
    let active = 0;
    let resolved = 0;
    let claimable = 0;

    for (const { position, market } of positions) {
      if (!market?.resolved) {
        active++;
      } else {
        resolved++;
        const outcome = market.outcome;
        if (outcome !== null && outcome !== undefined) {
          const userWinningBet = outcome ? position.yesAmount : position.noAmount;
          if (userWinningBet > 0n && !position.claimed) {
            claimable++;
          }
        }
      }
    }

    return { all: positions.length, active, resolved, claimable };
  }, [positions]);

  if (loading && positions.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-2.5 text-sm text-muted">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading your positions...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red/20 bg-red-muted p-6 text-center">
        <p className="text-sm text-red-text mb-3">{error}</p>
        <button
          onClick={fetchPositions}
          className="text-sm font-medium text-red-text hover:text-red transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-low bg-bg2 p-12 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-bg3 border border-border-low flex items-center justify-center mb-4">
          <svg className="h-7 w-7 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p className="text-sm font-medium text-foreground-secondary mb-1">No positions yet</p>
        <p className="text-xs text-muted mb-5">Place your first bet to start tracking your activity</p>
        <Link
          href="/"
          className="inline-block rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          Browse markets
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ActivityStats stats={stats} isLoading={loading} />

      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 rounded-xl bg-bg2 border border-border-low p-1">
            {(["all", "active", "resolved", "claimable"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                  activeTab === tab
                    ? "bg-bg3 text-foreground shadow-sm"
                    : "text-muted hover:text-foreground-secondary"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tabCounts[tab] > 0 && (
                  <span className={`ml-1.5 text-xs ${activeTab === tab ? "text-foreground-secondary" : "text-muted"}`}>
                    {tabCounts[tab]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={fetchPositions}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground-secondary transition-colors disabled:opacity-50"
          >
            <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>

        {/* Positions */}
        {filteredPositions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-low bg-bg2 p-10 text-center">
            <p className="text-sm text-muted">
              No {activeTab === "all" ? "" : activeTab} positions
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPositions.map((item, index) => (
              <PositionCard
                key={item.positionAddress}
                position={item.position}
                positionAddress={item.positionAddress}
                market={item.market}
                marketAddress={item.marketAddress}
                onUpdate={fetchPositions}
                animationDelay={index * 50}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
