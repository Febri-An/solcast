"use client";

/**
 * Realtime UserPosition subscriptions keyed by wallet.
 *
 * Two exports:
 *   - `usePositionsRealtime(wallet)` — all positions for a wallet, plus
 *     the Markets referenced by those positions (for the activity page).
 *   - `useUserPositionRealtime(wallet, market)` — a single (wallet, market)
 *     pair, used inside the trading hook so the sidebar reflects the user's
 *     shares the moment the DB row updates.
 *
 * Both rely on `positions_cache` being added to the supabase_realtime
 * publication (see migration 005). When the browser cannot open a realtime
 * channel we fall back to the REST endpoint with a slow poll.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { type Address } from "@solana/kit";

import { getMarketDecoder, type Market } from "../generated/prediction_market";
import {
  getUserPositionDecoder,
  type UserPosition,
} from "../generated/prediction_market/accounts/userPosition";
import { getBrowserSupabase, isBrowserSupabaseConfigured } from "../lib/supabase/browser";

export interface PositionWithAddress {
  positionAddress: Address;
  position: UserPosition;
  marketAddress: Address;
}

interface PositionsCacheRow {
  address: string;
  market_address: string;
  user_address: string;
  account_data_base64: string;
}

const FALLBACK_POLL_MS = 8_000;

function decodePositionRow(row: PositionsCacheRow): PositionWithAddress | null {
  try {
    const bytes = Uint8Array.from(atob(row.account_data_base64), (c) =>
      c.charCodeAt(0),
    );
    return {
      positionAddress: row.address as Address,
      position: getUserPositionDecoder().decode(bytes),
      marketAddress: row.market_address as Address,
    };
  } catch (err) {
    console.warn("[positions-realtime] decode failed:", row.address, err);
    return null;
  }
}

function decodeMarketBase64(b64: string): Market | null {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return getMarketDecoder().decode(bytes);
  } catch (err) {
    console.warn("[positions-realtime] market decode failed:", err);
    return null;
  }
}

export interface UsePositionsRealtimeResult {
  positions: PositionWithAddress[];
  markets: Map<string, Market>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Activity page helper — all positions owned by `wallet` with their markets.
 */
export function usePositionsRealtime(
  wallet: Address | null,
): UsePositionsRealtimeResult {
  const [positions, setPositions] = useState<PositionWithAddress[]>([]);
  const [markets, setMarkets] = useState<Map<string, Market>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const positionsRef = useRef<Map<string, PositionWithAddress>>(new Map());
  const marketsRef = useRef<Map<string, Market>>(new Map());

  const commitPositions = useCallback(() => {
    setPositions(Array.from(positionsRef.current.values()));
  }, []);

  const commitMarkets = useCallback(() => {
    setMarkets(new Map(marketsRef.current));
  }, []);

  const snapshot = useCallback(async () => {
    if (!wallet) {
      positionsRef.current = new Map();
      marketsRef.current = new Map();
      commitPositions();
      commitMarkets();
      setLoading(false);
      return;
    }
    setError(null);
    const supabase = getBrowserSupabase();

    try {
      if (supabase) {
        const { data: positionRows, error: pErr } = await supabase
          .from("positions_cache")
          .select("address, market_address, user_address, account_data_base64")
          .eq("user_address", wallet);
        if (pErr) throw pErr;

        const nextPositions = new Map<string, PositionWithAddress>();
        const marketAddresses = new Set<string>();
        for (const row of (positionRows ?? []) as PositionsCacheRow[]) {
          const decoded = decodePositionRow(row);
          if (decoded) {
            nextPositions.set(decoded.positionAddress, decoded);
            marketAddresses.add(decoded.marketAddress);
          }
        }

        const nextMarkets = new Map<string, Market>();
        if (marketAddresses.size > 0) {
          const { data: marketRows, error: mErr } = await supabase
            .from("markets_cache")
            .select("address, account_data_base64")
            .in("address", Array.from(marketAddresses));
          if (mErr) throw mErr;

          for (const row of (marketRows ?? []) as Array<{
            address: string;
            account_data_base64: string;
          }>) {
            const m = decodeMarketBase64(row.account_data_base64);
            if (m) nextMarkets.set(row.address, m);
          }
        }

        positionsRef.current = nextPositions;
        marketsRef.current = nextMarkets;
        commitPositions();
        commitMarkets();
      } else {
        // Fallback: REST endpoint returns positions + relevant markets.
        const response = await fetch(
          `/api/positions?wallet=${encodeURIComponent(wallet)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as {
          positions: Array<{
            address: string;
            marketAddress: string;
            accountDataBase64: string;
          }>;
          markets: Array<{ address: string; accountDataBase64: string }>;
        };

        const nextPositions = new Map<string, PositionWithAddress>();
        for (const p of payload.positions ?? []) {
          const decoded = decodePositionRow({
            address: p.address,
            market_address: p.marketAddress,
            user_address: wallet,
            account_data_base64: p.accountDataBase64,
          });
          if (decoded) nextPositions.set(decoded.positionAddress, decoded);
        }

        const nextMarkets = new Map<string, Market>();
        for (const m of payload.markets ?? []) {
          const decoded = decodeMarketBase64(m.accountDataBase64);
          if (decoded) nextMarkets.set(m.address, decoded);
        }

        positionsRef.current = nextPositions;
        marketsRef.current = nextMarkets;
        commitPositions();
        commitMarkets();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load positions";
      console.error("[positions-realtime] snapshot failed:", err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [wallet, commitPositions, commitMarkets]);

  useEffect(() => {
    setLoading(true);
    void snapshot();
  }, [snapshot]);

  // Realtime subscriptions (or fallback polling).
  useEffect(() => {
    if (!wallet) return;

    if (!isBrowserSupabaseConfigured()) {
      const id = setInterval(() => {
        void snapshot();
      }, FALLBACK_POLL_MS);
      return () => clearInterval(id);
    }

    const supabase = getBrowserSupabase();
    if (!supabase) return;

    const positionsChannel = supabase
      .channel(`positions-${wallet}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "positions_cache",
          filter: `user_address=eq.${wallet}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { address?: string } | null;
            if (old?.address) {
              positionsRef.current.delete(old.address);
              commitPositions();
            }
            return;
          }
          const row = payload.new as PositionsCacheRow | null;
          if (!row) return;
          const decoded = decodePositionRow(row);
          if (decoded) {
            positionsRef.current.set(decoded.positionAddress, decoded);
            commitPositions();

            // Make sure we have the related market cached too (for the card).
            if (!marketsRef.current.has(decoded.marketAddress)) {
              void snapshot();
            }
          }
        },
      )
      .subscribe();

    // Also subscribe to markets_cache for "any" change so the activity view
    // reflects resolutions / trades on markets we already track.
    const marketsChannel = supabase
      .channel(`positions-markets-${wallet}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "markets_cache" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { address?: string } | null;
            if (old?.address) {
              marketsRef.current.delete(old.address);
              commitMarkets();
            }
            return;
          }
          const row = payload.new as {
            address: string;
            account_data_base64: string;
          } | null;
          if (!row) return;
          // Only track markets we care about (referenced by one of our positions).
          const positionsArr = Array.from(positionsRef.current.values());
          const isRelevant = positionsArr.some((p) => p.marketAddress === row.address);
          if (!isRelevant) return;
          const decoded = decodeMarketBase64(row.account_data_base64);
          if (decoded) {
            marketsRef.current.set(row.address, decoded);
            commitMarkets();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(positionsChannel);
      void supabase.removeChannel(marketsChannel);
    };
  }, [wallet, snapshot, commitPositions, commitMarkets]);

  return { positions, markets, loading, error, refresh: snapshot };
}

/**
 * Lightweight single-pair subscription used by the market detail page so
 * the trade sidebar reflects a user's shares live.
 */
export function useUserPositionRealtime(
  wallet: Address | null,
  market: Address | null,
): {
  position: UserPosition | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [loading, setLoading] = useState(true);

  const snapshot = useCallback(async () => {
    if (!wallet || !market) {
      setPosition(null);
      setLoading(false);
      return;
    }

    const supabase = getBrowserSupabase();
    try {
      if (supabase) {
        const { data, error: selErr } = await supabase
          .from("positions_cache")
          .select("account_data_base64")
          .eq("user_address", wallet)
          .eq("market_address", market)
          .maybeSingle();
        if (selErr && selErr.code !== "PGRST116") throw selErr;
        const b64 = (data as { account_data_base64?: string } | null)?.account_data_base64;
        if (!b64) {
          setPosition(null);
          return;
        }
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        setPosition(getUserPositionDecoder().decode(bytes));
      } else {
        // Fallback via REST API.
        const response = await fetch(
          `/api/positions?wallet=${encodeURIComponent(wallet)}&market=${encodeURIComponent(market)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as {
          positions: Array<{ accountDataBase64: string }>;
        };
        const b64 = payload.positions?.[0]?.accountDataBase64;
        if (!b64) {
          setPosition(null);
          return;
        }
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        setPosition(getUserPositionDecoder().decode(bytes));
      }
    } catch (err) {
      console.warn("[user-position-realtime] snapshot failed:", err);
      setPosition(null);
    } finally {
      setLoading(false);
    }
  }, [wallet, market]);

  useEffect(() => {
    setLoading(true);
    void snapshot();
  }, [snapshot]);

  useEffect(() => {
    if (!wallet || !market) return;
    if (!isBrowserSupabaseConfigured()) return;

    const supabase = getBrowserSupabase();
    if (!supabase) return;

    const channel = supabase
      .channel(`user-pos-${wallet}-${market}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "positions_cache",
          filter: `user_address=eq.${wallet}`,
        },
        (payload) => {
          // Only react if the change is for the market we care about.
          const row =
            (payload.new as PositionsCacheRow | null) ??
            (payload.old as PositionsCacheRow | null);
          if (!row || row.market_address !== market) return;

          if (payload.eventType === "DELETE") {
            setPosition(null);
            return;
          }
          const b64 = (payload.new as PositionsCacheRow).account_data_base64;
          try {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            setPosition(getUserPositionDecoder().decode(bytes));
          } catch (err) {
            console.warn("[user-position-realtime] decode failed:", err);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [wallet, market]);

  return { position, loading, refresh: snapshot };
}
