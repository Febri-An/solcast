"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ProbabilityHistoryChartProps {
  marketAddress: string;
  /** Bump when pool state changes so we refetch after trades / realtime. */
  poolRevision: string;
}

type SnapshotRow = {
  recorded_at: string;
  yes_bps: number;
};

export function ProbabilityHistoryChart({
  marketAddress,
  poolRevision,
}: ProbabilityHistoryChartProps): ReactNode {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/markets/${encodeURIComponent(marketAddress)}/snapshots?limit=400`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as {
          snapshots?: SnapshotRow[];
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (!cancelled) setSnapshots(body.snapshots ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load chart");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [marketAddress, poolRevision]);

  const chartData = useMemo(
    () =>
      snapshots.map((row) => ({
        t: new Date(row.recorded_at).getTime(),
        pct: row.yes_bps / 100,
      })),
    [snapshots],
  );

  const gradientId = `yesProb-${marketAddress.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  if (loading) {
    return (
      <div className="rounded-xl border border-border-low bg-bg2 p-4">
        <div className="skeleton mb-3 h-4 w-40 rounded" />
        <div className="skeleton h-52 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border-low bg-bg2 px-4 py-6 text-center text-xs text-muted">
        Could not load probability history ({error})
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-low bg-bg2/50 px-4 py-8 text-center">
        <p className="text-sm font-medium text-foreground-secondary">No history yet</p>
        <p className="mt-1 text-xs text-muted leading-relaxed">
          Points appear when the pool updates (trades, sync, or keeper). Open a short market and place a few bets to see the line move.
        </p>
      </div>
    );
  }

  const fmtTime = (ts: number) =>
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));

  return (
    <div className="rounded-xl border border-border-low bg-bg2 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">YES probability</h3>
          <p className="text-[11px] text-muted">Implied odds over time (from cached pool snapshots)</p>
        </div>
        <span className="font-mono text-xs text-green-text tabular-nums">
          {chartData[chartData.length - 1]?.pct.toFixed(2)}%
        </span>
      </div>

      <div className="h-52 w-full min-h-[13rem]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) => fmtTime(v)}
              stroke="#6b7280"
              tick={{ fill: "#6b7280", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            />
            <YAxis
              domain={[0, 100]}
              width={36}
              stroke="#6b7280"
              tick={{ fill: "#6b7280", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const raw = payload[0]?.value;
                const n = typeof raw === "number" ? raw : Number(raw);
                const pct = Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
                return (
                  <div
                    className="rounded-[10px] border border-border-low bg-bg2 px-3 py-2 text-xs shadow-lg shadow-black/40"
                  >
                    <p className="mb-1 text-[11px] text-muted">{fmtTime(Number(label))}</p>
                    <p className="font-mono font-semibold text-green-text">{pct} YES</p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="pct"
              stroke="#4ade80"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: "#4ade80" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
