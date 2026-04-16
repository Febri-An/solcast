"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { type Address } from "@solana/kit";

import {
  getMarketDecoder,
  type Market,
  PREDICTION_MARKET_PROGRAM_ADDRESS,
} from "../generated/prediction_market";
import { MarketCard } from "./market-card";

const MARKET_DISCRIMINATOR_BASE58 = "dkokXHR3DTw";
const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const POLL_INTERVAL_MS = 3000;

interface MarketWithAddress {
  address: Address;
  market: Market;
}

type FilterTab = "active" | "past";

export function MarketsList(): ReactNode {
  const [markets, setMarkets] = useState<MarketWithAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("active");

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(DEVNET_RPC_URL, {
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
                    bytes: MARKET_DISCRIMINATOR_BASE58,
                  },
                },
              ],
            },
          ],
        }),
      });

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error.message);
      }

      const decoder = getMarketDecoder();
      const fetchedMarkets: MarketWithAddress[] = [];

      for (const account of result.result || []) {
        try {
          const data = Uint8Array.from(atob(account.account.data[0]), c => c.charCodeAt(0));
          const market = decoder.decode(data);
          fetchedMarkets.push({
            address: account.pubkey as Address,
            market,
          });
        } catch (decodeError) {
          console.warn("Failed to decode market account:", account.pubkey, decodeError);
        }
      }

      fetchedMarkets.sort((a, b) => Number(b.market.resolutionTime - a.market.resolutionTime));

      setMarkets(fetchedMarkets);
    } catch (err) {
      console.error("Failed to fetch markets:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch markets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
    const interval = setInterval(fetchMarkets, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMarkets]);

  const { activeMarkets, pastMarkets } = useMemo(() => {
    const active: MarketWithAddress[] = [];
    const past: MarketWithAddress[] = [];

    for (const item of markets) {
      if (item.market.resolved) {
        past.push(item);
      } else {
        active.push(item);
      }
    }

    active.sort((a, b) => Number(a.market.resolutionTime - b.market.resolutionTime));
    past.sort((a, b) => Number(b.market.resolutionTime - a.market.resolutionTime));

    return { activeMarkets: active, pastMarkets: past };
  }, [markets]);

  const displayedMarkets = activeTab === "active" ? activeMarkets : pastMarkets;

  if (loading && markets.length === 0) {
    return (
      <div className="rounded-2xl border border-border-low bg-bg2 overflow-hidden">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border-low last:border-b-0">
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-3/4 rounded" />
              <div className="skeleton h-3 w-1/4 rounded" />
            </div>
            <div className="flex gap-2">
              <div className="skeleton h-8 w-20 rounded-lg" />
              <div className="skeleton h-8 w-20 rounded-lg" />
            </div>
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
        <div className="flex items-center gap-1 rounded-xl bg-bg2 border border-border-low p-1">
          <button
            onClick={() => setActiveTab("active")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
              activeTab === "active"
                ? "!cursor-default bg-bg3 text-foreground shadow-sm"
                : "text-muted hover:text-foreground-secondary"
            }`}
          >
            Active
            {activeMarkets.length > 0 && (
              <span className={`ml-1.5 text-xs ${activeTab === "active" ? "text-foreground-secondary" : "text-muted"}`}>
                {activeMarkets.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("past")}
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
      ) : (
        <div className="rounded-2xl border border-border-low bg-bg2 overflow-hidden divide-y divide-border-low">
          {displayedMarkets.map((item) => (
            <MarketCard
              key={item.address}
              market={item.market}
              marketAddress={item.address}
              onUpdate={fetchMarkets}
            />
          ))}
        </div>
      )}
    </div>
  );
}
