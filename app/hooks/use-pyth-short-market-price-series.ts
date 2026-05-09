"use client";

import { HermesClient } from "@pythnetwork/hermes-client";
import type { ReadonlyUint8Array } from "@solana/kit";
import { useEffect, useMemo, useState } from "react";

import {
  HERMES_URL,
  feedIdToHermesHex,
  pythPriceFromParsedComponent,
} from "../lib/pyth-hermes-price";

export type OraclePricePoint = { t: number; price: number };

export type ShortMarketPriceStatus =
  | "idle"
  | "loading"
  | "live"
  | "frozen"
  | "historical"
  | "error";

interface UsePythShortMarketPriceSeriesArgs {
  /** When false, clears state and does not open Hermes (e.g. long-window market or another tab). */
  enabled: boolean;
  feedId: ReadonlyUint8Array;
  marketId: bigint;
  resolutionTime: bigint;
  isResolved: boolean;
}

function linspaceTimes(fromSec: number, toSec: number, count: number): number[] {
  if (count <= 1) return [toSec];
  const span = toSec - fromSec;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Math.floor(fromSec + (span * i) / (count - 1)));
  }
  return out;
}

/**
 * Hermes SSE price series for short-window markets (≤5m), capped at `resolutionTime`.
 * Live: streams until wall time or oracle time passes resolution, then freezes.
 * Past/resolved without live session: reconstructs a path by sampling Hermes at timestamps.
 */
export function usePythShortMarketPriceSeries({
  enabled,
  feedId,
  marketId,
  resolutionTime,
  isResolved,
}: UsePythShortMarketPriceSeriesArgs): {
  points: OraclePricePoint[];
  status: ShortMarketPriceStatus;
  error: string | null;
  lastPrice: number | null;
} {
  const [points, setPoints] = useState<OraclePricePoint[]>([]);
  const [status, setStatus] = useState<ShortMarketPriceStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const resolutionSec = Number(resolutionTime);
  const createdSec = Math.floor(Number(marketId) / 1000);

  const feedHex = useMemo(() => feedIdToHermesHex(feedId), [feedId]);

  const lastPrice = useMemo(() => {
    if (!enabled || points.length === 0) return null;
    return points[points.length - 1].price;
  }, [enabled, points]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const client = new HermesClient(HERMES_URL);
    const streamBox: { current: EventSource | null } = { current: null };
    let wallTimer: ReturnType<typeof setInterval> | null = null;

    function stopLiveStream() {
      if (wallTimer !== null) {
        clearInterval(wallTimer);
        wallTimer = null;
      }
      streamBox.current?.close();
      streamBox.current = null;
    }

    async function loadHistoricalPath() {
      setStatus("loading");
      setError(null);
      setPoints([]);

      const to = resolutionSec;
      let from = Math.min(createdSec, to - 1);
      if (from > to - 1) from = Math.max(0, to - 300);
      const span = Math.max(0, to - from);
      const sampleCount = Math.min(32, Math.max(2, Math.floor(span / 12) + 2));
      const times = linspaceTimes(from, to, sampleCount);

      const results = await Promise.all(
        times.map(async (ts) => {
          try {
            const up = await client.getPriceUpdatesAtTimestamp(ts, [feedHex], {
              parsed: true,
            });
            const parsed = up.parsed?.[0];
            if (!parsed?.price) return null;
            const pub = parsed.price.publish_time;
            if (pub > resolutionSec) return null;
            return {
              t: pub * 1000,
              price: pythPriceFromParsedComponent(parsed.price),
            } satisfies OraclePricePoint;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;

      const ok = results.filter((p): p is OraclePricePoint => p !== null);
      ok.sort((a, b) => a.t - b.t);
      const dedup: OraclePricePoint[] = [];
      for (const p of ok) {
        const last = dedup[dedup.length - 1];
        if (last && Math.abs(last.t - p.t) < 500) continue;
        dedup.push(p);
      }

      setPoints(dedup);
      setStatus("historical");
      if (dedup.length === 0) {
        setError("Could not load oracle samples for this window.");
      }
    }

    async function runLive() {
      setError(null);
      setStatus("loading");
      setPoints([]);

      try {
        const latest = await client.getLatestPriceUpdates([feedHex], { parsed: true });
        const p0 = latest.parsed?.[0];
        if (p0?.price) {
          const pub = p0.price.publish_time;
          if (pub <= resolutionSec) {
            setPoints([
              {
                t: pub * 1000,
                price: pythPriceFromParsedComponent(p0.price),
              },
            ]);
          }
        }
      } catch {
        /* stream may still deliver */
      }

      if (cancelled) return;

      setStatus("live");

      try {
        streamBox.current = await client.getPriceUpdatesStream([feedHex], {
          parsed: true,
          allowUnordered: false,
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not open price stream");
          setStatus("error");
        }
        return;
      }

      const es = streamBox.current;
      if (!es || cancelled) {
        es?.close();
        return;
      }

      const feedIdNorm = feedHex.toLowerCase();

      const freezeIfPastResolution = () => {
        if (cancelled) return;
        setStatus("frozen");
        stopLiveStream();
      };

      es.onmessage = (ev: MessageEvent) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(ev.data as string) as {
            parsed?: Array<{
              id?: string;
              price?: { price: string; expo: number; publish_time: number };
            }>;
          };
          for (const u of data.parsed ?? []) {
            const id = String(u.id ?? "")
              .toLowerCase()
              .replace(/^0x/, "");
            const mine = feedIdNorm.replace(/^0x/, "");
            if (id !== mine) continue;
            const pr = u.price;
            if (!pr?.price) continue;
            const pub = pr.publish_time;
            if (pub > resolutionSec) {
              freezeIfPastResolution();
              return;
            }
            const price = pythPriceFromParsedComponent(pr);
            setPoints((prev) => {
              const tMs = pub * 1000;
              const next = prev.filter((p) => p.t !== tMs);
              next.push({ t: tMs, price });
              next.sort((a, b) => a.t - b.t);
              return next.length > 3500 ? next.slice(-3500) : next;
            });
          }
        } catch {
          /* ignore malformed */
        }
      };

      es.onerror = () => {
        if (!cancelled && streamBox.current) {
          setError("Stream interrupted — reconnect by refreshing.");
        }
      };

      wallTimer = setInterval(() => {
        if (cancelled) return;
        if (Date.now() / 1000 >= resolutionSec) {
          freezeIfPastResolution();
        }
      }, 350);
    }

    void (async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      if (isResolved || nowSec >= resolutionSec) {
        await loadHistoricalPath();
        return;
      }
      await runLive();
    })();

    return () => {
      cancelled = true;
      stopLiveStream();
    };
  }, [enabled, feedHex, resolutionSec, createdSec, isResolved, marketId, resolutionTime]);

  if (!enabled) {
    return {
      points: [] as OraclePricePoint[],
      status: "idle" as const,
      error: null,
      lastPrice: null,
    };
  }

  return { points, status, error, lastPrice };
}
