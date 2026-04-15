"use client";

import { type ReactNode, useCallback } from "react";

import Link from "next/link";

import { type Address, type Option, isSome } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";

import { type Market } from "../generated/prediction_market";
import { useMarketTrading } from "../hooks/use-market-trading";
import { useProfile } from "../hooks/use-profile";
import { formatSol, formatVolume, getTimeRemaining } from "../lib/market-format";
import { useToast } from "./toast";

interface MarketCardProps {
  market: Market;
  marketAddress: Address;
  onUpdate?: () => void;
}

function unwrapOutcome(option: Option<boolean>): boolean | null {
  return isSome(option) ? option.value : null;
}

const TRADE_HASH = "#market-trade";

export function MarketCard({ market, marketAddress, onUpdate }: MarketCardProps): ReactNode {
  const { status } = useWalletConnection();
  const { openProfileModal, configured: profileConfigured } = useProfile();
  const { showToast } = useToast();

  const handleClaimSuccess = useCallback(() => {
    showToast("Winnings claimed successfully.");
  }, [showToast]);

  const {
    isSending,
    txStatus,
    isResolving,
    isResolved,
    resolutionTime,
    canBet,
    canResolve,
    totalPool,
    yesPercent,
    noPercent,
    handleResolve,
    handleClaim,
    canClaim,
    claimPayout,
    isProfileComplete,
  } = useMarketTrading(market, marketAddress, onUpdate, {
    onClaimSuccess: handleClaimSuccess,
  });

  const canTrade = canBet && status === "connected" && (!profileConfigured || isProfileComplete);
  const marketHref = `/market/${marketAddress}${TRADE_HASH}`;

  return (
    <div className="group border-b border-border-low last:border-b-0 transition-colors hover:bg-bg2/60">
      {/* Main row: link overlay on background; controls stay above */}
      <div className="relative flex items-center gap-4 px-4 py-3.5 sm:px-5">
        <Link
          href={`/market/${marketAddress}`}
          className="absolute inset-0 z-0 rounded-none"
          aria-label={`Open market: ${market.question}`}
        />

        {/* Question + metadata */}
        <div className="relative z-[1] flex-1 min-w-0 pointer-events-none">
          <div className="flex items-center gap-2.5 mb-0.5">
            <h3 className="text-[15px] font-medium leading-snug text-foreground truncate">
              {market.question}
            </h3>
            {isResolved && (
              <span
                className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                  unwrapOutcome(market.outcome)
                    ? "bg-green-muted text-green-text"
                    : "bg-red-muted text-red-text"
                }`}
              >
                {unwrapOutcome(market.outcome) ? "Yes" : "No"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1"
                />
              </svg>
              {formatVolume(totalPool)} SOL
            </span>
            {!isResolved && (
              <span className="flex items-center gap-1">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {canBet ? getTimeRemaining(resolutionTime) : "Pending resolve"}
              </span>
            )}
          </div>
        </div>

        {/* Probability display */}
        <div className="relative z-[1] hidden sm:flex items-center gap-2 shrink-0 pointer-events-none">
          <div className="w-24 h-1.5 rounded-full bg-bg3 overflow-hidden flex">
            <div
              className="bg-green transition-all duration-500"
              style={{ width: `${yesPercent}%` }}
            />
          </div>
          <span className="text-xs text-muted font-mono w-8 text-right">{yesPercent}%</span>
        </div>

        {/* Action buttons — navigate to market page to trade */}
        <div className="relative z-10 flex items-center gap-2 shrink-0 pointer-events-auto">
          {canTrade && (
            <>
              <Link
                href={marketHref}
                onClick={(e) => e.stopPropagation()}
                className="rounded-lg bg-green-muted text-green-text px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-green/20"
              >
                Yes {yesPercent}¢
              </Link>
              <Link
                href={marketHref}
                onClick={(e) => e.stopPropagation()}
                className="rounded-lg bg-red-muted text-red-text px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-red/20"
              >
                No {noPercent}¢
              </Link>
            </>
          )}

          {canBet && status === "connected" && profileConfigured && !isProfileComplete && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openProfileModal("username");
              }}
              className="rounded-lg border border-amber/30 bg-amber-muted px-3 py-1.5 text-xs font-semibold text-amber"
            >
              Set username
            </button>
          )}

          {canBet && status !== "connected" && (
            <>
              <Link
                href={marketHref}
                onClick={(e) => e.stopPropagation()}
                className="rounded-lg bg-green-muted text-green-text px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-green/20"
              >
                Yes {yesPercent}¢
              </Link>
              <Link
                href={marketHref}
                onClick={(e) => e.stopPropagation()}
                className="rounded-lg bg-red-muted text-red-text px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-red/20"
              >
                No {noPercent}¢
              </Link>
            </>
          )}

          {canResolve && status === "connected" && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleResolve();
              }}
              disabled={isSending || isResolving}
              className="rounded-lg bg-amber-muted text-amber px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-amber/20 disabled:opacity-40"
            >
              {isResolving ? "Resolving..." : "Resolve"}
            </button>
          )}

          {canResolve && status !== "connected" && (
            <span className="rounded-lg bg-amber-muted text-amber px-4 py-1.5 text-sm font-semibold">
              Pending
            </span>
          )}

          {isResolved && canClaim && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleClaim();
              }}
              disabled={isSending}
              className="rounded-lg bg-green-muted text-green-text px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-green/20 disabled:opacity-40"
            >
              {isSending ? "Claiming..." : `Claim ${formatSol(claimPayout)}`}
            </button>
          )}

          {isResolved && !canClaim && !canResolve && (
            <span
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${
                unwrapOutcome(market.outcome)
                  ? "bg-green-muted text-green-text"
                  : "bg-red-muted text-red-text"
              }`}
            >
              {unwrapOutcome(market.outcome) ? `Yes ${yesPercent}¢` : `No ${noPercent}¢`}
            </span>
          )}
        </div>
      </div>

      {/* Status message (resolve / claim / errors) */}
      {txStatus && (
        <div className="relative z-10 px-4 pb-3 sm:px-5">
          <p className="text-xs text-muted font-mono">{txStatus}</p>
        </div>
      )}
    </div>
  );
}
