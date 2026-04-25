"use client";

import { type ReactNode, useMemo, useState } from "react";

import Link from "next/link";

import { type Address } from "@solana/kit";

import { type Market } from "../generated/prediction_market";
import { type UserPosition } from "../generated/prediction_market/accounts/userPosition";
import { usePositionsRealtime } from "../hooks/use-positions-realtime";
import { ActivityStats } from "./activity-stats";
import { PositionCard } from "./position-card";

interface PositionWithMarket {
  positionAddress: Address;
  position: UserPosition;
  marketAddress: Address;
  market: Market | null;
}

export interface ActivityStatsData {
  /** Sum of shares currently held across active positions (approx TVL). */
  totalInvested: bigint;
  /** Sum of redeemable winnings pending on resolved markets. */
  totalWon: bigint;
  /** Paid-out positions (zeroed shares on resolved markets). */
  totalClaimed: bigint;
  /** Sum of losing-side shares on resolved markets. */
  totalLost: bigint;
  /** Placeholder — we don't track cost basis yet. */
  roiPercent: number;
  activePositions: number;
  claimablePositions: number;
}

type FilterTab = "all" | "active" | "resolved" | "claimable";

interface PositionsListProps {
  walletAddress: Address;
}

export function PositionsList({ walletAddress }: PositionsListProps): ReactNode {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const {
    positions: rawPositions,
    markets: marketMap,
    loading,
    error,
    refresh: fetchPositions,
  } = usePositionsRealtime(walletAddress);

  const positions = useMemo<PositionWithMarket[]>(() => {
    const enriched = rawPositions.map((p) => ({
      positionAddress: p.positionAddress,
      position: p.position,
      marketAddress: p.marketAddress,
      market: marketMap.get(p.marketAddress) ?? null,
    }));
    enriched.sort((a, b) => {
      const aTime = a.market?.resolutionTime ?? 0n;
      const bTime = b.market?.resolutionTime ?? 0n;
      return Number(bTime - aTime);
    });
    return enriched;
  }, [rawPositions, marketMap]);

  const stats = useMemo((): ActivityStatsData => {
    let totalInvested = 0n;
    let totalWon = 0n;
    let totalClaimed = 0n;
    let totalLost = 0n;
    let activeCount = 0;
    let claimableCount = 0;

    for (const { position, market } of positions) {
      const heldShares = position.yesShares + position.noShares;

      if (!market || !market.resolved) {
        // Active position — sum held shares as a proxy for "invested size".
        totalInvested += heldShares;
        activeCount++;
        continue;
      }

      const outcome = market.outcome;
      if (outcome === null || outcome === undefined) continue;

      const winningShares = outcome ? position.yesShares : position.noShares;
      const losingShares = outcome ? position.noShares : position.yesShares;

      totalLost += losingShares;
      if (winningShares > 0n) {
        totalWon += winningShares;
        claimableCount++;
      } else if (heldShares === 0n) {
        // Likely already redeemed — we don't know the actual amount anymore.
        totalClaimed += 0n;
      }
    }

    // Without cost-basis tracking we can't compute a meaningful ROI on-chain;
    // leave it at zero until we persist trade history.
    const roiPercent = 0;

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

      // "claimable" = resolved market + user still holds winning shares
      if (!market?.resolved) return false;
      const outcome = market.outcome;
      if (outcome === null || outcome === undefined) return false;
      const winningShares = outcome ? position.yesShares : position.noShares;
      return winningShares > 0n;
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
          const winningShares = outcome ? position.yesShares : position.noShares;
          if (winningShares > 0n) claimable++;
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
