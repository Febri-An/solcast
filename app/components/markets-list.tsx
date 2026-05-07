"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { useMarketsRealtime, type MarketWithAddress } from "../hooks/use-markets-realtime";
import { isOpenForBetting } from "../lib/market-format";
import { MarketCard } from "./market-card";

export type MarketsFilterTab = "active" | "past";

interface MarketsListProps {
  activeTab: MarketsFilterTab;
  onActiveTabChange: (tab: MarketsFilterTab) => void;
}

export function MarketsList({ activeTab, onActiveTabChange }: MarketsListProps): ReactNode {
  const { markets: rawMarkets, loading, error, refresh } = useMarketsRealtime();

  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const markets = useMemo<MarketWithAddress[]>(
    () =>
      [...rawMarkets].sort(
        (a, b) => Number(b.market.resolutionTime - a.market.resolutionTime),
      ),
    [rawMarkets],
  );

  const fetchMarkets = refresh;

  const { bettingMarkets, pastMarkets } = useMemo(() => {
    const betting: MarketWithAddress[] = [];
    const past: MarketWithAddress[] = [];

    for (const item of markets) {
      if (item.market.resolved) {
        past.push(item);
      } else if (isOpenForBetting(item.market, nowSec)) {
        betting.push(item);
      }
    }

    betting.sort((a, b) => Number(a.market.resolutionTime - b.market.resolutionTime));
    past.sort((a, b) => Number(b.market.resolutionTime - a.market.resolutionTime));

    return { bettingMarkets: betting, pastMarkets: past };
  }, [markets, nowSec]);

  const displayedMarkets = activeTab === "active" ? bettingMarkets : pastMarkets;

  if (loading && markets.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border-low bg-bg2 p-4 space-y-3 min-h-[220px]"
          >
            <div className="flex gap-2">
              <div className="skeleton h-10 w-10 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-3 w-2/3 rounded" />
              </div>
              <div className="skeleton h-12 w-12 shrink-0 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="skeleton h-20 rounded-xl" />
              <div className="skeleton h-20 rounded-xl" />
            </div>
            <div className="skeleton h-4 w-1/2 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red/20 bg-red-muted p-6 text-center">
        <p className="text-sm text-red-text mb-3">{error}</p>
        <button
          onClick={fetchMarkets}
          className="text-sm font-medium text-red-text hover:text-red transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-low bg-bg2 p-12 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-bg3 flex items-center justify-center mb-4">
          <svg className="h-7 w-7 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p className="text-sm font-medium text-foreground-secondary mb-1">No markets yet</p>
        <p className="text-xs text-muted">Create the first market to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-bg2 border border-border-low p-1">
          <button
            onClick={() => onActiveTabChange("active")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
              activeTab === "active"
                ? "!cursor-default bg-bg3 text-foreground shadow-sm"
                : "text-muted hover:text-foreground-secondary"
            }`}
          >
            Active
            {bettingMarkets.length > 0 && (
              <span className={`ml-1.5 text-xs ${activeTab === "active" ? "text-foreground-secondary" : "text-muted"}`}>
                {bettingMarkets.length}
              </span>
            )}
          </button>
          <button
            onClick={() => onActiveTabChange("past")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
              activeTab === "past"
                ? "!cursor-default bg-bg3 text-foreground shadow-sm"
                : "text-muted hover:text-foreground-secondary"
            }`}
          >
            Resolved
            {pastMarkets.length > 0 && (
              <span className={`ml-1.5 text-xs ${activeTab === "past" ? "text-foreground-secondary" : "text-muted"}`}>
                {pastMarkets.length}
              </span>
            )}
          </button>
        </div>
        <button
          onClick={fetchMarkets}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground-secondary transition-colors disabled:opacity-50"
        >
          <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {/* Markets list */}
      {displayedMarkets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-low bg-bg2 p-10 text-center">
          <p className="text-sm text-muted">
            {activeTab === "active"
              ? "No active markets. Create one to get started!"
              : "No resolved markets yet."}
          </p>
        </div>
      ) : activeTab === "active" ? (
        <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {displayedMarkets.map((item) => (
            <div key={item.address} className="min-w-0 flex flex-col">
              <MarketCard
                market={item.market}
                marketAddress={item.address}
                vaultLamports={item.vaultLamports}
                onUpdate={fetchMarkets}
                nowSec={nowSec}
                density="grid"
                className="h-full min-h-0"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border-low bg-bg2 overflow-hidden divide-y divide-border-low">
          {displayedMarkets.map((item) => (
            <MarketCard
              key={item.address}
              market={item.market}
              marketAddress={item.address}
              vaultLamports={item.vaultLamports}
              onUpdate={fetchMarkets}
              nowSec={nowSec}
            />
          ))}
        </div>
      )}
    </div>
  );
}
