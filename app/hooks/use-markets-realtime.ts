"use client";

/**
 * Realtime Markets subscription.
 *
 * Source of truth for the UI is `markets_cache` in Supabase. The keeper
 * (and write-through calls from the app after trades) keeps that table
 * in sync with on-chain state. This hook:
 *
 *   1. Does one initial snapshot fetch via Supabase (or `/api/markets`
 *      fallback when realtime is unavailable).
 *   2. Opens a single postgres_changes channel and merges INSERT /
 *      UPDATE / DELETE events into local state.
 *   3. Exposes a `refresh()` for manual retries / error recovery.
 *
 * With realtime enabled the browser never polls; price updates arrive
 * within a few hundred ms of the row being written.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { type Address } from "@solana/kit";

import { getMarketDecoder, type Market } from "../generated/prediction_market";
import { getBrowserSupabase, isBrowserSupabaseConfigured } from "../lib/supabase/browser";

export interface MarketWithAddress {
  address: Address;
  market: Market;
}

/** Row shape in `markets_cache`. */
interface MarketsCacheRow {
  address: string;
  account_data_base64: string;
}

/** Fallback polling when realtime / Supabase env is missing. */
const FALLBACK_POLL_MS = 8_000;

function decodeRow(row: MarketsCacheRow): MarketWithAddress | null {
  try {
    const bytes = Uint8Array.from(atob(row.account_data_base64), (c) =>
      c.charCodeAt(0),
    );
    return {
      address: row.address as Address,
      market: getMarketDecoder().decode(bytes),
    };
  } catch (err) {
    console.warn("[markets-realtime] decode failed:", row.address, err);
    return null;
  }
}

export interface UseMarketsRealtimeResult {
  markets: MarketWithAddress[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMarketsRealtime(): UseMarketsRealtimeResult {
  const [markets, setMarkets] = useState<MarketWithAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Latest snapshot kept in a ref so event handlers don't close over stale state. */
  const cacheRef = useRef<Map<string, MarketWithAddress>>(new Map());

  const commit = useCallback(() => {
    setMarkets(Array.from(cacheRef.current.values()));
  }, []);

  const snapshot = useCallback(async () => {
    setError(null);

    const supabase = getBrowserSupabase();
    try {
      if (supabase) {
        const { data, error: selErr } = await supabase
          .from("markets_cache")
          .select("address, account_data_base64");
        if (selErr) throw selErr;

        const next = new Map<string, MarketWithAddress>();
        for (const row of (data ?? []) as MarketsCacheRow[]) {
          const decoded = decodeRow(row);
          if (decoded) next.set(decoded.address, decoded);
        }
        cacheRef.current = next;
        commit();
      } else {
        // Fallback: go through the API route which reads with the service role.
        const response = await fetch("/api/markets", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as {
          markets: Array<{ address: string; accountDataBase64: string }>;
        };
        const next = new Map<string, MarketWithAddress>();
        for (const row of payload.markets ?? []) {
          const decoded = decodeRow({
            address: row.address,
            account_data_base64: row.accountDataBase64,
          });
          if (decoded) next.set(decoded.address, decoded);
        }
        cacheRef.current = next;
        commit();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load markets";
      console.error("[markets-realtime] snapshot failed:", err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [commit]);

  // Initial snapshot.
  useEffect(() => {
    void snapshot();
  }, [snapshot]);

  // Realtime subscription (or fallback polling).
  useEffect(() => {
    if (!isBrowserSupabaseConfigured()) {
      const id = setInterval(() => {
        void snapshot();
      }, FALLBACK_POLL_MS);
      return () => clearInterval(id);
    }

    const supabase = getBrowserSupabase();
    if (!supabase) return;

    const channel = supabase
      .channel("markets-cache")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "markets_cache" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { address?: string } | null;
            if (old?.address) {
              cacheRef.current.delete(old.address);
              commit();
            }
            return;
          }

          const row = payload.new as MarketsCacheRow | null;
          if (!row) return;
          const decoded = decodeRow(row);
          if (decoded) {
            cacheRef.current.set(decoded.address, decoded);
            commit();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [snapshot, commit]);

  return { markets, loading, error, refresh: snapshot };
}

/**
 * Subscribe to a single market row. Used on the detail page so a single
 * account change pushes through with the minimum possible latency.
 */
export function useMarketRealtime(address: Address | null): {
  market: Market | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!address) {
      setMarket(null);
      setLoading(false);
      return;
    }
    setError(null);
    const supabase = getBrowserSupabase();
    try {
      if (supabase) {
        const { data, error: selErr } = await supabase
          .from("markets_cache")
          .select("account_data_base64")
          .eq("address", address)
          .maybeSingle();
        if (selErr) throw selErr;
        if (!data) {
          // Cache miss: ask the server to bootstrap from RPC so the
          // subsequent realtime UPDATE can fill us in.
          await fetch("/api/markets/sync-one", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address }),
          }).catch(() => {});
          setMarket(null);
          return;
        }
        const decoded = decodeRow({
          address,
          account_data_base64: (data as { account_data_base64: string }).account_data_base64,
        });
        setMarket(decoded?.market ?? null);
      } else {
        // Fallback to the API route when browser Supabase is not configured.
        const response = await fetch(
          `/api/markets/${encodeURIComponent(address)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as {
          market: { accountDataBase64: string };
        };
        const b64 = payload.market?.accountDataBase64;
        if (!b64) {
          setMarket(null);
          return;
        }
        const decoded = decodeRow({ address, account_data_base64: b64 });
        setMarket(decoded?.market ?? null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load market";
      console.error("[market-realtime] snapshot failed:", err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setLoading(true);
    void fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!address) return;
    if (!isBrowserSupabaseConfigured()) return;

    const supabase = getBrowserSupabase();
    if (!supabase) return;

    const channel = supabase
      .channel(`market-${address}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "markets_cache",
          filter: `address=eq.${address}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setMarket(null);
            return;
          }
          const row = payload.new as MarketsCacheRow | null;
          if (!row) return;
          const decoded = decodeRow(row);
          setMarket(decoded?.market ?? null);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [address]);

  return { market, loading, error, refresh: fetchSnapshot };
}
