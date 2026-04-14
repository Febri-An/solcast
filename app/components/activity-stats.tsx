"use client";

import { type ReactNode } from "react";

import { type ActivityStatsData } from "./positions-list";

const LAMPORTS_PER_SOL = 1_000_000_000n;

interface ActivityStatsProps {
  stats: ActivityStatsData;
  isLoading: boolean;
}

function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / Number(LAMPORTS_PER_SOL);
  if (sol === 0) return "0";
  if (Math.abs(sol) < 0.01) return sol.toFixed(4);
  if (Math.abs(sol) < 1) return sol.toFixed(3);
  return sol.toFixed(2);
}

export function ActivityStats({ stats }: ActivityStatsProps): ReactNode {
  const netPnL = stats.totalWon - stats.totalLost;
  const isPositive = netPnL >= 0n;
  const hasActivity = stats.totalInvested > 0n;

  const roiColorClass = !hasActivity ? "text-muted" : isPositive ? "text-green-text" : "text-red-text";
  const roiPrefix = !hasActivity ? "" : stats.roiPercent >= 0 ? "+" : "";
  const roiValue = hasActivity ? stats.roiPercent.toFixed(1) : "0.0";

  return (
    <div className="animate-fade-in">
      <div className="grid gap-3 md:grid-cols-12">
        {/* ROI card */}
        <div className="md:col-span-5 rounded-2xl border border-border-low bg-bg2 p-6 relative overflow-hidden">
          <div className={`absolute inset-0 opacity-[0.04] ${isPositive ? "bg-gradient-to-br from-green" : "bg-gradient-to-br from-red"}`} />
          <div className="relative">
            <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">
              Return on Investment
            </p>
            <span className={`font-mono text-4xl font-bold tracking-tight ${roiColorClass}`}>
              {roiPrefix}{roiValue}%
            </span>
            {hasActivity && (
              <p className={`mt-2 text-sm font-mono ${isPositive ? "text-green-text/80" : "text-red-text/80"}`}>
                {isPositive ? "+" : "-"}{formatSol(isPositive ? netPnL : -netPnL)} SOL net
              </p>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="md:col-span-7 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border-low bg-bg2 p-4 animate-fade-in stagger-1">
            <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Total Invested</p>
            <p className="font-mono text-2xl font-semibold tracking-tight">
              {formatSol(stats.totalInvested)}
              <span className="text-sm font-normal text-muted ml-1">SOL</span>
            </p>
          </div>
          <div className="rounded-2xl border border-border-low bg-bg2 p-4 animate-fade-in stagger-2">
            <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Total Claimed</p>
            <p className="font-mono text-2xl font-semibold tracking-tight text-green-text">
              {formatSol(stats.totalClaimed)}
              <span className="text-sm font-normal text-green-text/70 ml-1">SOL</span>
            </p>
          </div>
          <div className="rounded-2xl border border-border-low bg-bg2 p-4 animate-fade-in stagger-3">
            <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Profit Won</p>
            <p className="font-mono text-2xl font-semibold tracking-tight text-green-text">
              +{formatSol(stats.totalWon)}
              <span className="text-sm font-normal text-green-text/70 ml-1">SOL</span>
            </p>
          </div>
          <div className="rounded-2xl border border-border-low bg-bg2 p-4 animate-fade-in stagger-4">
            <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Total Lost</p>
            <p className="font-mono text-2xl font-semibold tracking-tight text-red-text">
              -{formatSol(stats.totalLost)}
              <span className="text-sm font-normal text-red-text/70 ml-1">SOL</span>
            </p>
          </div>
        </div>
      </div>

      {/* Claimable banner */}
      {stats.claimablePositions > 0 && (
        <div className="mt-4 rounded-2xl bg-green-muted border border-green/20 p-4 flex items-center justify-between animate-fade-in stagger-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green/20">
              <svg className="h-5 w-5 text-green-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-green-text">
                {stats.claimablePositions} winning{" "}
                {stats.claimablePositions === 1 ? "position" : "positions"} to claim
              </p>
              <p className="text-sm text-green-text/70">
                Switch to the &ldquo;Claimable&rdquo; tab to collect your winnings
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
