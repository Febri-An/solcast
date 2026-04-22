"use client";

import { type ReactNode, useCallback, useState } from "react";

import Image from "next/image";
import Link from "next/link";

import { type Address, type Option, isSome } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";

import { type Market } from "../generated/prediction_market";
import { useMarketTrading } from "../hooks/use-market-trading";
import { useProfile } from "../hooks/use-profile";
import {
  formatSol,
  formatVolume,
  getTimeRemaining,
  isShortLiveWindowMarket,
} from "../lib/market-format";
import { getAssetBrandName, getAssetIconSrc } from "../lib/price-feeds";
import { useToast } from "./toast";

interface MarketCardProps {
  market: Market;
  marketAddress: Address;
  onUpdate?: () => void;
  /** Multi-column grid on home (tab Active); tighter card layout. */
  density?: "grid" | "list";
  className?: string;
}

function unwrapOutcome(option: Option<boolean>): boolean | null {
  return isSome(option) ? option.value : null;
}

const TRADE_HASH = "#market-trade";

function SentimentRing({ percent, compact }: { percent: number; compact?: boolean }): ReactNode {
  const value = Math.min(100, Math.max(0, percent));
  const width = compact ? 68 : 92;
  const height = compact ? 44 : 58;
  const cx = width / 2;
  const cy = height - (compact ? 4 : 5);
  const r = compact ? 26 : 35;
  const arcPath = `M${cx - r},${cy} A${r},${r} 0 0,1 ${cx + r},${cy}`;
  const arcLength = Math.PI * r;
  const activeArc = (value / 100) * arcLength;
  const needleLength = compact ? 20 : 27;
  const angle = Math.PI + (value / 100) * Math.PI;
  const needleX = cx + needleLength * Math.cos(angle);
  const needleY = cy + needleLength * Math.sin(angle);

  const getSentiment = (v: number): { text: string; colorClass: string } => {
    if (v < 15) return { text: "Strong No", colorClass: "text-red-text" };
    if (v < 35) return { text: "Likely No", colorClass: "text-red-text" };
    if (v < 45) return { text: "Leaning No", colorClass: "text-amber" };
    if (v < 55) return { text: "Uncertain", colorClass: "text-amber" };
    if (v < 65) return { text: "Leaning Yes", colorClass: "text-green-text" };
    if (v < 85) return { text: "Likely Yes", colorClass: "text-green-text" };
    return { text: "Strong Yes", colorClass: "text-green-text" };
  };

  const sentiment = getSentiment(value);

  return (
    <div
      className={`relative flex shrink-0 flex-col items-center justify-center ${
        compact ? "h-[64px] w-[68px]" : "h-[82px] w-[92px]"
      }`}
    >
      <span
        className={`relative z-[1] font-semibold leading-none ${
          compact ? "-mb-1 text-[9px]" : "mb-1 text-[10px]"
        } ${sentiment.colorClass}`}
      >
        {sentiment.text}
      </span>
 

      <svg className="relative z-[1]" viewBox={`0 0 ${width} ${height}`} aria-hidden>
        <defs>
          <linearGradient id={`sentiment-gauge-${compact ? "compact" : "default"}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#E24B4A" />
            <stop offset="50%" stopColor="#EF9F27" />
            <stop offset="100%" stopColor="#639922" />
          </linearGradient>
        </defs>

        <path
          d={arcPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={compact ? 5 : 6}
          strokeLinecap="round"
          className="text-bg3"
        />
        <path
          d={arcPath}
          fill="none"
          stroke={`url(#sentiment-gauge-${compact ? "compact" : "default"})`}
          strokeWidth={compact ? 5 : 6}
          strokeLinecap="round"
          opacity="0.25"
        />
        <path
          d={arcPath}
          fill="none"
          stroke={`url(#sentiment-gauge-${compact ? "compact" : "default"})`}
          strokeWidth={compact ? 5 : 6}
          strokeLinecap="round"
          strokeDasharray={`${activeArc} ${arcLength}`}
        />

        <line
          x1={cx}
          y1={cy}
          x2={needleX + 0.8}
          y2={needleY + 0.8}
          stroke="rgba(0,0,0,0.12)"
          strokeWidth={compact ? 1.8 : 2}
          strokeLinecap="round"
        />
        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="currentColor"
          strokeWidth={compact ? 1.3 : 1.6}
          strokeLinecap="round"
          className="text-foreground"
        />
        <circle cx={cx} cy={cy} r={compact ? 3.8 : 5} fill="currentColor" className="text-bg2" />
        <circle cx={cx} cy={cy} r={compact ? 1.6 : 2} fill="currentColor" className="text-muted" />
      </svg>

      <span
        className={`relative z-[1] font-bold font-mono leading-none text-foreground ${
          compact ? "mt-0.5 text-[10px]" : "mt-1 text-[12px]"
        }`}
      >
        {value}%
      </span>
    </div>
  );
}

const ASSET_ICON_INNER_ZOOM = 1.24;

function AssetIcon({ feedId }: { feedId: Market["feedId"]; compact?: boolean }): ReactNode {
  const iconSrc = getAssetIconSrc(feedId);
  const brand = getAssetBrandName(feedId);
  const size = 40;
  const box = "h-10 w-10";
  const frame = `relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-low bg-bg3 shadow-inner ${box}`;

  if (iconSrc) {
    return (
      <div className={frame}>
        <Image
          src={iconSrc}
          alt={brand}
          fill
          sizes={`${size}px`}
          className="object-cover object-center"
          style={{ transform: `scale(${ASSET_ICON_INNER_ZOOM})` }}
        />
      </div>
    );
  }

  return (
    <div className={`${frame} font-bold text-foreground-secondary`} aria-hidden>
      ◈
    </div>
  );
}

export function MarketCard({
  market,
  marketAddress,
  onUpdate,
  density = "list",
  className,
}: MarketCardProps): ReactNode {
  const { status } = useWalletConnection();
  const { openProfileModal, configured: profileConfigured } = useProfile();
  const { showToast } = useToast();
  const [bookmarked, setBookmarked] = useState(false);

  const handleRedeemSuccess = useCallback(() => {
    showToast("Winnings redeemed successfully.");
  }, [showToast]);

  const {
    isSending,
    txStatus,
    isResolving,
    isResolved,
    resolutionTime,
    canTrade: canTradeMarket,
    canResolve,
    totalShares,
    yesPercent,
    noPercent,
    handleResolve,
    handleRedeem,
    canRedeem,
    redeemPayout,
    isProfileComplete,
  } = useMarketTrading(market, marketAddress, onUpdate, {
    onRedeemSuccess: handleRedeemSuccess,
  });

  const canTrade =
    canTradeMarket && status === "connected" && (!profileConfigured || isProfileComplete);
  const marketHref = `/market/${marketAddress}${TRADE_HASH}`;

  const brandName = getAssetBrandName(market.feedId);

  const showUpDownCard = !isResolved && canTradeMarket;
  const isGrid = density === "grid";
  const shortLiveWindow = isShortLiveWindowMarket(market);

  if (showUpDownCard) {
    return (
      <div
        className={`relative flex h-full flex-col rounded-2xl border border-border-low bg-bg2 shadow-sm transition-colors hover:border-border-strong/80 ${
          isGrid ? "p-3" : "p-4"
        } ${className ?? ""}`}
      >
        <Link
          href={`/market/${marketAddress}`}
          className="absolute inset-0 z-0 rounded-2xl"
          aria-label={`Open market: ${market.question}`}
        />

        {/* Header */}
        <div className={`relative z-[1] flex gap-2 sm:gap-3 pointer-events-none ${isGrid ? "mb-5" : "mb-4"}`}>
          <AssetIcon feedId={market.feedId} compact={isGrid} />
          <div className="min-w-0 flex-1 pt-0.5">
            <h3
              className={`font-semibold leading-snug text-foreground line-clamp-2 ${
                isGrid ? "text-[15px]" : "text-[15px]"
              }`}
            >
              {market.question}
            </h3>
            {/* 2m/5m: no subtitle; LIVE in footer. Longer: time left here; vol in footer. */}
            {!shortLiveWindow && (
              <p className={`mt-1 text-muted ${isGrid ? "text-[10px] leading-tight" : "text-xs"}`}>
                {getTimeRemaining(resolutionTime)} left
              </p>
            )}
          </div>
          <SentimentRing percent={yesPercent} compact={isGrid} />
        </div>

        {/* Up / Down — maps to Yes / No on-chain */}
        <div className={`relative z-10 grid grid-cols-2 gap-1.5 sm:gap-2 pointer-events-auto ${isGrid ? "mb-3" : "mb-4"}`}>
          <Link
            href={marketHref}
            onClick={(e) => e.stopPropagation()}
            className={`flex flex-col items-center justify-center rounded-sm bg-green-muted/90 px-2 transition hover:bg-green/20 ${
              isGrid ? "min-h-[35px]" : "min-h-[88px]"
            }`}
          >
            <span className={`font-bold text-green-text ${isGrid ? "text-base" : "text-lg"}`}>Up</span>
          </Link>

          <Link
            href={marketHref}
            onClick={(e) => e.stopPropagation()}
            className={`flex flex-col items-center justify-center rounded-sm bg-red-muted/90 transition hover:bg-red/20 px-2 ${
              isGrid ? "min-h-[35px]" : "min-h-[88px] px-3"
            }`}
          >
            <span className={`font-bold text-red-text ${isGrid ? "text-base" : "text-lg"}`}>Down</span>
          </Link>
        </div>

        {/* Footer */}
        <div className="relative z-10 mt-auto flex items-center justify-between gap-1 pointer-events-auto">
          <div className={`flex min-w-0 items-center gap-1.5 ${isGrid ? "text-[10px]" : "text-xs"}`}>
            {shortLiveWindow ? (
              <>
                <span
                  className={`flex shrink-0 items-center gap-1 rounded-md bg-red/10 font-semibold uppercase tracking-wide text-red-text ${
                    isGrid ? "px-1.5 py-0.5 text-[9px]" : "gap-1.5 px-2 py-0.5"
                  }`}
                >
                  <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-40" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red" />
                  </span>
                  Live
                </span>
                <span className="truncate text-muted">{brandName}</span>
              </>
            ) : (
              <>
                <span className="shrink-0 font-mono font-medium text-foreground-secondary">
                  {formatVolume(totalShares)} vol
                </span>
                <span className="text-border-strong">·</span>
                <span className="truncate text-muted">{brandName}</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {canTradeMarket && status === "connected" && profileConfigured && !isProfileComplete && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openProfileModal("username");
                }}
                className="rounded-md border border-amber/30 bg-amber-muted px-2 py-1 text-[10px] font-semibold text-amber"
              >
                Username
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setBookmarked((v) => !v);
              }}
              className={`rounded-lg text-muted transition hover:bg-bg3 hover:text-foreground-secondary ${
                isGrid ? "p-1" : "p-1.5"
              }`}
              aria-label={bookmarked ? "Remove bookmark" : "Bookmark market"}
            >
              <svg
                className={isGrid ? "h-4 w-4" : "h-5 w-5"}
                fill={bookmarked ? "currentColor" : "none"}
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                />
              </svg>
            </button>
          </div>
        </div>

        {txStatus && (
          <div className={`relative z-10 border-t border-border-low ${isGrid ? "mt-2 pt-2" : "mt-3 pt-3"}`}>
            <p className={`text-muted font-mono ${isGrid ? "text-[10px]" : "text-xs"}`}>{txStatus}</p>
          </div>
        )}
      </div>
    );
  }

  /* ——— Compact row: pending resolve or resolved ——— */
  const rowInGrid = isGrid;
  const isPendingResolveGrid = rowInGrid && !isResolved && !canTradeMarket;
  return (
    <div
      className={
        rowInGrid
          ? `group rounded-2xl border border-border-low bg-bg2 transition-colors hover:border-border-strong/60 ${className ?? ""}`
          : `group border-b border-border-low last:border-b-0 transition-colors hover:bg-bg2/60 ${className ?? ""}`
      }
    >
      <div
        className={`relative flex items-center gap-4 ${
          rowInGrid ? (isPendingResolveGrid ? "px-4 py-4" : "px-4 py-3") : "px-4 py-3.5 sm:px-5"
        }`}
      >
        <Link
          href={`/market/${marketAddress}`}
          className="absolute inset-0 z-0 rounded-none"
          aria-label={`Open market: ${market.question}`}
        />

        <div className="relative z-[1] flex-1 min-w-0 pointer-events-none">
          <div className="flex items-center pb-2 gap-2.5 mb-0.5">
            <h3
              className={`text-[15px] font-medium leading-snug text-foreground ${
                isPendingResolveGrid
                  ? "line-clamp-3 min-h-[3.875rem] break-words"
                  : "truncate"
              }`}
            >
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
              {formatVolume(totalShares)} SOL vol.
            </span>
          </div>
        </div>

        {/* <div className="relative z-[1] hidden sm:flex items-center gap-2 shrink-0 pointer-events-none">
          <div className="w-24 h-1.5 rounded-full bg-bg3 overflow-hidden flex">
            <div
              className="bg-green transition-all duration-500"
              style={{ width: `${yesPercent}%` }}
            />
          </div>
          <span className="text-xs text-muted font-mono w-8 text-right">{yesPercent}%</span>
        </div> */}

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

          {canTradeMarket && status === "connected" && profileConfigured && !isProfileComplete && (
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

          {canTradeMarket && status !== "connected" && (
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

          {isResolved && canRedeem && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleRedeem();
              }}
              disabled={isSending}
              className="rounded-lg bg-green-muted text-green-text px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-green/20 disabled:opacity-40"
            >
              {isSending ? "Claiming..." : `Claim ${formatSol(redeemPayout)}`}
            </button>
          )}

          {isResolved && !canRedeem && !canResolve && (
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

      {txStatus && (
        <div className="relative z-10 px-4 pb-3 sm:px-5">
          <p className="text-xs text-muted font-mono">{txStatus}</p>
        </div>
      )}
    </div>
  );
}
