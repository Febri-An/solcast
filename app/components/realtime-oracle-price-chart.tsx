"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  OraclePricePoint,
  ShortMarketPriceStatus,
} from "../hooks/use-pyth-short-market-price-series";

/**
 * Rolling window along **oracle publish time** (not wall clock).
 * Hermes timestamps can lag the browser clock; anchoring to the latest `publish_time`
 * keeps points inside the X domain so the line stays visible.
 */
const LIVE_WINDOW_MS = 10_000;

/**
 * Y-axis range from visible prices: zoom in when the window is flat, leave more
 * breathing room when price swings (volatility) are large relative to the mid price.
 */
function computeDynamicPriceYDomain(
  prices: number[],
  strikeUsd: number,
): [number, number] | undefined {
  const finite = prices.filter((p) => Number.isFinite(p));
  if (finite.length === 0) return undefined;

  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  const mid = (hi + lo) / 2;
  const span = hi - lo;

  // Keep strike visible only when it sits near the traded band (avoid squashing the line).
  if (strikeUsd > 0 && mid > 0) {
    const strikeDist = Math.abs(strikeUsd - mid) / mid;
    if (strikeDist < 0.08) {
      lo = Math.min(lo, strikeUsd);
      hi = Math.max(hi, strikeUsd);
    }
  }

  const effSpan = hi - lo;
  const scale = Math.max(mid, 1);

  if (!(effSpan > 0) || !Number.isFinite(effSpan)) {
    const band = Math.max(scale * 0.00012, 2);
    return [lo - band, hi + band];
  }

  // Relative movement in window (dimensionless). ~0.00025 ⇒ $20 on $80k.
  const rel = effSpan / scale;

  // Low rel → stagnant: larger pad as *fraction of span* so the band looks snug but not zero-height.
  // High rel → volatile: smaller fraction (data already spread out) plus absolute cushion.
  let padRatio: number;
  if (rel < 0.00025) {
    padRatio = 0.42;
  } else if (rel < 0.001) {
    const t = (rel - 0.00025) / 0.00075;
    padRatio = 0.42 - t * 0.24;
  } else if (rel < 0.005) {
    const t = (rel - 0.001) / 0.004;
    padRatio = 0.18 - t * 0.08;
  } else {
    padRatio = 0.08 + Math.min(0.1, (rel - 0.005) * 3);
  }

  const pad = Math.max(effSpan * padRatio, scale * 1.2e-5, 0.25);
  return [lo - pad, hi + pad];
}

export interface RealtimeOraclePriceChartProps {
  assetLabel: string;
  points: OraclePricePoint[];
  targetUsd: number;
  status: ShortMarketPriceStatus;
  error: string | null;
  lastPrice: number | null;
  resolutionTimeSec: number;
  height?: number;
}

export function RealtimeOraclePriceChart({
  assetLabel,
  points,
  targetUsd,
  status,
  error,
  lastPrice,
  resolutionTimeSec,
  height = 440,
}: RealtimeOraclePriceChartProps): ReactNode {
  const rows = useMemo(
    () => points.map((p) => ({ t: p.t, price: p.price })),
    [points],
  );

  const { chartData, xDomain } = useMemo(() => {
    if (rows.length === 0) {
      return { chartData: [] as { t: number; price: number }[], xDomain: undefined as [number, number] | undefined };
    }

    const maxT = Math.max(...rows.map((r) => r.t));
    const startMs = maxT - LIVE_WINDOW_MS;
    const windowed = rows.filter((r) => r.t >= startMs).sort((a, b) => a.t - b.t);

    const data =
      windowed.length > 0 ? windowed : [rows.reduce((a, b) => (a.t >= b.t ? a : b))];

    // Domain must match oracle time range so points are never drawn off-screen.
    const d0 = Math.min(...data.map((r) => r.t));
    const d1 = Math.max(...data.map((r) => r.t));
    const padEndMs = 400;
    const domainRight = status === "live" ? Math.max(d1 + padEndMs, maxT) : d1;
    const domainLeft = Math.min(startMs, d0);

    return {
      chartData: data,
      xDomain: [domainLeft, Math.max(domainRight, domainLeft + 100)] as [number, number],
    };
  }, [rows, status]);

  const yDomain = useMemo(
    () => computeDynamicPriceYDomain(chartData.map((d) => d.price), targetUsd),
    [chartData, targetUsd],
  );

  const subtitle = useMemo(() => {
    if (status === "loading" || status === "idle") return "Connecting to Pyth Hermes…";
    if (status === "live")
      return "Live oracle · last 10s of publish times · stops at resolution";
    if (status === "frozen") return "Stopped at resolution · last 10 seconds shown";
    if (status === "historical")
      return "Oracle sampled to resolution · last 10 seconds shown";
    if (status === "error") return "Update stream unavailable";
    return "";
  }, [status]);

  const fmtTime = (ts: number) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(ts));

  const fmtUsd = (n: number) =>
    n >= 1000
      ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  /** Y-axis ticks: whole dollars for quick scanning. */
  const fmtUsdYAxis = (n: number) =>
    Math.round(Number(n)).toLocaleString(undefined, { maximumFractionDigits: 0 });

  if (error && chartData.length === 0) {
    return (
      <div className="rounded-xl border border-border-low bg-bg2 px-4 py-8 text-center text-sm text-muted">
        {error}
      </div>
    );
  }

  if (chartData.length === 0 && status !== "loading" && status !== "idle") {
    return (
      <div className="rounded-xl border border-dashed border-border-low bg-bg2/50 px-4 py-8 text-center text-sm text-muted">
        No oracle points in this window yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-low bg-bg2 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{assetLabel} — oracle USD</h3>
          <p className="text-[11px] text-muted">{subtitle}</p>
        </div>
        <div className="text-right">
          {lastPrice !== null && (
            <span className="font-mono text-xs text-sky-400 tabular-nums block">${fmtUsd(lastPrice)}</span>
          )}
          <span className="text-[10px] text-muted">
            Target ${fmtUsd(targetUsd)}
          </span>
        </div>
      </div>
      <p className="mb-3 text-[10px] text-muted">
        Resolution{" "}
        {new Date(resolutionTimeSec * 1000).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "medium",
        })}
      </p>

      <div className="w-full" style={{ height }}>
        {status === "loading" || status === "idle" ? (
          <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-muted">
            Loading Hermes…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 10, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={xDomain ?? ["dataMin", "dataMax"]}
                allowDataOverflow
                tickFormatter={(v: number) => fmtTime(v)}
                stroke="#6b7280"
                tick={{ fill: "#6b7280", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                minTickGap={28}
              />
              <YAxis
                dataKey="price"
                domain={yDomain ?? ["auto", "auto"]}
                allowDataOverflow={false}
                width={56}
                stroke="#6b7280"
                tick={{ fill: "#6b7280", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                tickFormatter={(v: number) => fmtUsdYAxis(v)}
              />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }}
                isAnimationActive={false}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const raw = payload[0]?.value;
                  const n = typeof raw === "number" ? raw : Number(raw);
                  const price = Number.isFinite(n) ? fmtUsd(n) : "—";
                  return (
                    <div className="rounded-[10px] border border-border-low bg-bg2 px-3 py-2 text-xs shadow-lg shadow-black/40">
                      <p className="mb-1 text-[11px] text-muted">{fmtTime(Number(label))}</p>
                      <p className="font-mono font-semibold text-foreground">${price}</p>
                    </div>
                  );
                }}
              />
              <ReferenceLine
                y={targetUsd}
                stroke="rgba(250, 204, 21, 0.65)"
                strokeDasharray="4 4"
                label={{
                  value: "Target",
                  position: "insideTopRight",
                  fill: "#a8a29e",
                  fontSize: 10,
                }}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#38bdf8"
                strokeWidth={2.25}
                dot={chartData.length < 4}
                activeDot={{ r: 5, strokeWidth: 0 }}
                isAnimationActive={status === "live" && chartData.length > 1}
                animationDuration={180}
                animationEasing="ease-out"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
