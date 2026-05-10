"use client";

import { type ReactNode, useCallback, useState } from "react";

import Link from "next/link";

import { type Address } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";

import { type Market } from "../generated/prediction_market";
import { useMarketRealtime } from "../hooks/use-markets-realtime";
import {
  TRADE_MAX_SLIPPAGE_OPTIONS,
  useMarketTrading,
  unwrapOutcome,
} from "../hooks/use-market-trading";
import { useProfile } from "../hooks/use-profile";
import {
  resolutionCountdownTextClassName,
  useResolutionCountdown,
} from "../hooks/use-resolution-countdown";
import {
  formatMarketTargetUsd,
  formatMarketVaultSolDisplay,
  formatSol,
  isShortLiveWindowMarket,
  marketTargetUsdAsNumber,
} from "../lib/market-format";
import { getAssetLabelForFeed, getTradingViewSymbolForFeed } from "../lib/price-feeds";
import { usePythShortMarketPriceSeries } from "../hooks/use-pyth-short-market-price-series";
import { RealtimeOraclePriceChart } from "./realtime-oracle-price-chart";
import { TradingViewChart } from "./tradingview-chart";
import { ProbabilityHistoryChart } from "./probability-history-chart";
import { ProbabilityPercent } from "./probability-percent";
import { useToast } from "./toast";

type DetailTab = "chart" | "rules" | "context";

interface MarketDetailViewProps {
  marketAddress: Address;
}

interface MarketDetailBodyProps {
  market: Market;
  marketAddress: Address;
  vaultLamports: bigint | null;
  onRefresh: () => void;
}

function MarketDetailBody({
  market,
  marketAddress,
  vaultLamports,
  onRefresh,
}: MarketDetailBodyProps): ReactNode {
  const { status } = useWalletConnection();
  const { openProfileModal, configured: profileConfigured } = useProfile();
  const { showToast } = useToast();
  const [tab, setTab] = useState<DetailTab>("chart");

  const handleTradeSuccess = useCallback(() => {
    showToast("Trade executed successfully.");
  }, [showToast]);

  const {
    isSending,
    tradeAmount,
    setTradeAmount,
    txStatus,
    isResolving,
    isResolved,
    resolutionTime,
    canTrade: canTradeMarket,
    canResolve,
    yesPercent,
    noPercent,
    userPosition,
    quoteForBuy,
    handleBuy,
    handleSell,
    handleResolve,
    handleRedeem,
    canRedeem,
    redeemPayout,
    estimatedYesExitLamports,
    estimatedNoExitLamports,
    netInvestedLamports,
    realizedPnlLamports,
    unrealizedPnlLamports,
    isCostBasisIncomplete,
    isProfileComplete,
    tradeMaxSlippageBps,
    setTradeMaxSlippageBps,
  } = useMarketTrading(market, marketAddress, onRefresh, {
    onTradeSuccess: handleTradeSuccess,
  });

  const canTrade =
    canTradeMarket && status === "connected" && (!profileConfigured || isProfileComplete);

  const yesQuote = quoteForBuy(true);
  const noQuote = quoteForBuy(false);

  const countdownActive = Boolean(canTradeMarket && !isResolved);
  const { label: countdownLabel, urgency: countdownUrgency } = useResolutionCountdown(
    resolutionTime,
    countdownActive,
  );

  const tvSymbol = getTradingViewSymbolForFeed(market.feedId);
  const assetLabel = getAssetLabelForFeed(market.feedId);
  const isShortLiveWindow = isShortLiveWindowMarket(market);
  const pythShortSeries = usePythShortMarketPriceSeries({
    enabled: isShortLiveWindow && tab === "chart",
    feedId: market.feedId,
    marketId: market.marketId,
    resolutionTime: market.resolutionTime,
    isResolved,
  });
  const strikeUsd = marketTargetUsdAsNumber(market.targetPrice, market.targetPriceEncoding);
  const outcome = unwrapOutcome(market.outcome);
  const shortAddr = `${marketAddress.slice(0, 4)}…${marketAddress.slice(-4)}`;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Link href="/" className="hover:text-foreground-secondary transition-colors">
          Markets
        </Link>
        <span className="text-border-strong">/</span>
        <span className="font-mono text-foreground-secondary">{shortAddr}</span>
      </div>

      {/* Title block */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {market.question}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
            <span className="rounded-full bg-bg3 border border-border-low px-2.5 py-0.5 text-xs font-medium text-foreground-secondary">
              {assetLabel}
            </span>
            <span
              className="flex items-center gap-1"
              title="Gross SOL on market account (vault, includes rent). Not the YES+NO reserve sum."
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1"
                />
              </svg>
              {formatMarketVaultSolDisplay(vaultLamports)} SOL vault
            </span>
            {!isResolved && (
              <span className="flex items-center gap-1">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {canTradeMarket ? (
                  countdownLabel === "Ended" ? (
                    <span className="font-mono text-xs text-muted">Trading ended</span>
                  ) : (
                    <>
                      <span className="text-muted">Ends in </span>
                      <span className={resolutionCountdownTextClassName(countdownUrgency)}>
                        {countdownLabel}
                      </span>
                    </>
                  )
                ) : (
                  "Awaiting resolution"
                )}
              </span>
            )}
            {isResolved && outcome !== null && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  outcome ? "bg-green-muted text-green-text" : "bg-red-muted text-red-text"
                }`}
              >
                Resolved {outcome ? "Yes" : "No"}
              </span>
            )}
          </div>
        </div>

        {/* Probability headline */}
        <div className="flex shrink-0 items-center gap-4 rounded-2xl border border-border-low bg-bg2 px-5 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Chance</p>
            <p className="leading-none">
              <ProbabilityPercent
                value={yesPercent}
                variant="yes"
                className="text-3xl font-bold font-mono"
              />
            </p>
            <p className="text-xs text-muted">yes</p>
          </div>
          <div className="h-12 w-px bg-border-low" />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">&nbsp;</p>
            <p className="leading-none">
              <ProbabilityPercent
                value={noPercent}
                variant="no"
                className="text-3xl font-bold font-mono"
              />
            </p>
            <p className="text-xs text-muted">no</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        {/* Main column */}
        <div className="space-y-4 lg:col-span-2">
          <div className="flex gap-1 rounded-xl border border-border-low bg-bg2 p-1">
            {(
              [
                ["chart", "Chart"],
                ["rules", "Rules"],
                ["context", "Market context"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  tab === id ? "bg-bg3 text-foreground shadow-sm" : "text-muted hover:text-foreground-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "chart" && (
            <div className="space-y-6">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    {isShortLiveWindow ? (
                      <>
                        Pyth oracle (Hermes) — line updates in real time, stops at resolution
                      </>
                    ) : (
                      <>
                        Live chart via TradingView — {tvSymbol.replace(":", " · ")}
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => void onRefresh()}
                    className="text-xs text-muted hover:text-foreground-secondary transition-colors"
                  >
                    Refresh data
                  </button>
                </div>
                {isShortLiveWindow ? (
                  <RealtimeOraclePriceChart
                    assetLabel={assetLabel}
                    points={pythShortSeries.points}
                    targetUsd={strikeUsd}
                    status={pythShortSeries.status}
                    error={pythShortSeries.error}
                    lastPrice={pythShortSeries.lastPrice}
                    resolutionTimeSec={resolutionTime}
                  />
                ) : (
                  <TradingViewChart symbol={tvSymbol} height={440} />
                )}
              </div>
              <ProbabilityHistoryChart
                marketAddress={marketAddress}
                poolRevision={`${market.yesShares}-${market.noShares}-${market.resolved}-${unwrapOutcome(market.outcome) ?? "pending"}`}
              />
            </div>
          )}

          {tab === "rules" && (
            <div className="rounded-2xl border border-border-low bg-bg2 p-5 space-y-4 text-sm text-foreground-secondary leading-relaxed">
              <p>
                This market resolves using a{" "}
                <span className="text-foreground font-medium">Pyth Network</span> price feed on
                Solana devnet. After the resolution time, anyone can submit a transaction that
                posts the latest verified price update and settles the market.
              </p>
              <p>
                <span className="text-foreground font-medium">YES</span> wins if the oracle price is{" "}
                <span className="text-foreground font-medium">strictly above</span>{" "}
                <span className="font-mono text-foreground">
                  ${formatMarketTargetUsd(market.targetPrice, market.targetPriceEncoding)}
                </span>{" "}
                USD at resolution. Otherwise <span className="text-foreground font-medium">NO</span>{" "}
                wins.
              </p>
              <p className="text-muted text-xs">
                Markets are experimental software on devnet — prices are for demonstration only and
                may differ from production oracle behavior.
              </p>
            </div>
          )}

          {tab === "context" && (
            <div className="rounded-2xl border border-border-low bg-bg2 p-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-border-low pb-3">
                <span className="text-muted">Asset</span>
                <span className="font-medium text-foreground text-right">{assetLabel}</span>
              </div>
              <div className="flex justify-between gap-4 border-b border-border-low pb-3">
                <span className="text-muted">Target (USD)</span>
                <span className="font-mono font-medium text-foreground">
                  ${formatMarketTargetUsd(market.targetPrice, market.targetPriceEncoding)}
                </span>
              </div>
              <div className="flex justify-between gap-4 border-b border-border-low pb-3">
                <span className="text-muted">Market id</span>
                <span className="font-mono text-xs text-foreground-secondary break-all text-right">
                  {market.marketId.toString()}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Pyth feed</span>
                <span className="font-mono text-[11px] text-foreground-secondary break-all text-right max-w-[70%]">
                  {Array.from(market.feedId)
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("")}
                </span>
              </div>
            </div>
          )}

          {/* Placeholder sections — Polymarket-style structure */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-dashed border-border-low bg-bg2/50 p-5">
              <h3 className="text-sm font-semibold text-foreground mb-1">Order book</h3>
              <p className="text-xs text-muted leading-relaxed">
                On-chain CLOB-style depth is not wired for this demo. Pool odds update as users buy
                YES/NO shares.
              </p>
            </div>
            <div className="rounded-xl border border-dashed border-border-low bg-bg2/50 p-5">
              <h3 className="text-sm font-semibold text-foreground mb-1">Discussion</h3>
              <p className="text-xs text-muted leading-relaxed">
                Comments would live here in a full product. For now, share feedback off-chain.
              </p>
            </div>
          </div>
        </div>

        {/* Trade sidebar — anchor for dashboard Yes/No links */}
        <aside id="market-trade" className="lg:col-span-1 scroll-mt-28">
          <div className="sticky top-24 rounded-2xl border border-border-low bg-bg2 overflow-hidden">
            <div className="border-b border-border-low px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Trade</h2>
              <p className="text-xs text-muted mt-0.5">Buy outcome shares with SOL</p>
            </div>

            <div className="p-4 space-y-4">
              {canTrade && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1.5">
                      Amount (SOL)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={tradeAmount}
                      onChange={(e) => setTradeAmount(e.target.value)}
                      disabled={isSending}
                      className="w-full rounded-xl border border-border-low bg-bg3 px-3 py-2.5 text-sm font-mono text-foreground outline-none placeholder:text-muted/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1.5">
                      Max slippage cap
                    </label>
                    <select
                      value={tradeMaxSlippageBps}
                      onChange={(e) => setTradeMaxSlippageBps(Number(e.target.value))}
                      disabled={isSending}
                      className="w-full rounded-xl border border-border-low bg-bg3 px-3 py-2.5 text-xs text-foreground-secondary outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
                    >
                      {TRADE_MAX_SLIPPAGE_OPTIONS.map((opt) => (
                        <option key={opt.bps} value={opt.bps}>
                          {opt.label} (dynamic sizing)
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[10px] text-muted leading-relaxed">
                      Each buy refetches pool state from RPC, computes slippage from trade size vs
                      liquidity (capped here), then retries up to 3× if simulation says the pool moved.
                      Raise the cap for large bets; very wide caps increase sandwich risk.
                    </p>
                  </div>
                  {(yesQuote || noQuote) && (
                    <div className="rounded-lg bg-bg3/60 border border-border-low px-3 py-2.5 text-[11px] space-y-1 font-mono text-foreground-secondary">
                      {yesQuote && (
                        <div className="flex justify-between">
                          <span className="text-green-text">Buy YES →</span>
                          <span>
                            {formatSol(yesQuote.out)} shares @ {(yesQuote.effectivePriceBps / 100).toFixed(1)}%
                          </span>
                        </div>
                      )}
                      {noQuote && (
                        <div className="flex justify-between">
                          <span className="text-red-text">Buy NO →</span>
                          <span>
                            {formatSol(noQuote.out)} shares @ {(noQuote.effectivePriceBps / 100).toFixed(1)}%
                          </span>
                        </div>
                      )}
                      <p className="text-muted text-[10px] pt-1 font-sans">
                        Fee {(market.feeBps / 100).toFixed(1)}% · dynamic slippage (≤{" "}
                        {(tradeMaxSlippageBps / 100).toFixed(1)}% cap)
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleBuy(true)}
                      disabled={isSending || !tradeAmount || parseFloat(tradeAmount) <= 0}
                      className="rounded-xl bg-green-muted py-3 text-sm font-bold text-green-text transition-colors hover:bg-green/20 disabled:opacity-40"
                    >
                      Yes{" "}
                      <ProbabilityPercent value={yesPercent} variant="yes" className="inline font-bold" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBuy(false)}
                      disabled={isSending || !tradeAmount || parseFloat(tradeAmount) <= 0}
                      className="rounded-xl bg-red-muted py-3 text-sm font-bold text-red-text transition-colors hover:bg-red/20 disabled:opacity-40"
                    >
                      No{" "}
                      <ProbabilityPercent value={noPercent} variant="no" className="inline font-bold" />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed">
                    CPMM pool — every share pays 1 SOL if its side wins. Prices shift as the pool trades.
                  </p>

                  {userPosition && (userPosition.yesShares > 0n || userPosition.noShares > 0n) && (
                    <div className="mt-4 rounded-xl border border-border-low bg-bg3/40 p-3 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Your position
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="rounded-md border border-border-low bg-bg2/70 px-2 py-1.5">
                          <p className="text-[10px] uppercase tracking-wide text-muted">Invested</p>
                          <p className="text-xs font-mono text-foreground-secondary">
                            {formatSol(netInvestedLamports)} SOL
                          </p>
                        </div>
                        <div className="rounded-md border border-border-low bg-bg2/70 px-2 py-1.5">
                          <p className="text-[10px] uppercase tracking-wide text-muted">Unrealized</p>
                          <p
                            className={`text-xs font-mono ${
                              unrealizedPnlLamports >= 0n ? "text-green-text" : "text-red-text"
                            }`}
                          >
                            {unrealizedPnlLamports >= 0n ? "+" : "-"}
                            {formatSol(unrealizedPnlLamports >= 0n ? unrealizedPnlLamports : -unrealizedPnlLamports)}{" "}
                            SOL
                          </p>
                        </div>
                        <div className="rounded-md border border-border-low bg-bg2/70 px-2 py-1.5">
                          <p className="text-[10px] uppercase tracking-wide text-muted">Realized</p>
                          <p
                            className={`text-xs font-mono ${
                              realizedPnlLamports >= 0n ? "text-green-text" : "text-red-text"
                            }`}
                          >
                            {realizedPnlLamports >= 0n ? "+" : "-"}
                            {formatSol(realizedPnlLamports >= 0n ? realizedPnlLamports : -realizedPnlLamports)} SOL
                          </p>
                        </div>
                      </div>
                      {isCostBasisIncomplete && (
                        <p className="text-[10px] text-amber-text/90 leading-snug rounded-md bg-amber-muted/30 border border-amber/20 px-2 py-1.5">
                          Invested and unrealized require cost basis recorded after trades (Supabase{" "}
                          <code className="text-[10px]">position_metrics</code>). If invested stays zero,
                          check env keys and migrations — until then unrealized equals exit value, not true
                          profit.
                        </p>
                      )}
                      {userPosition.yesShares > 0n && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-col">
                            <span className="text-xs text-green-text font-mono">
                              YES {formatSol(userPosition.yesShares)} shares
                            </span>
                            <span className="text-[11px] text-muted font-mono">
                              Est. exit {formatSol(estimatedYesExitLamports)} SOL
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSell(true, userPosition.yesShares)}
                            disabled={isSending}
                            className="rounded-md border border-border-low bg-bg2 px-2 py-1 text-[11px] font-semibold text-foreground-secondary transition hover:border-foreground-muted hover:text-foreground disabled:opacity-40"
                          >
                            Sell all
                          </button>
                        </div>
                      )}
                      {userPosition.noShares > 0n && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-col">
                            <span className="text-xs text-red-text font-mono">
                              NO {formatSol(userPosition.noShares)} shares
                            </span>
                            <span className="text-[11px] text-muted font-mono">
                              Est. exit {formatSol(estimatedNoExitLamports)} SOL
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSell(false, userPosition.noShares)}
                            disabled={isSending}
                            className="rounded-md border border-border-low bg-bg2 px-2 py-1 text-[11px] font-semibold text-foreground-secondary transition hover:border-foreground-muted hover:text-foreground disabled:opacity-40"
                          >
                            Sell all
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {canTradeMarket && status === "connected" && profileConfigured && !isProfileComplete && (
                <div className="rounded-xl border border-amber/25 bg-amber-muted/40 px-4 py-4 text-center">
                  <p className="text-sm text-foreground-secondary mb-3">
                    Set a username in your profile before trading.
                  </p>
                  <button
                    type="button"
                    onClick={() => openProfileModal("username")}
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover transition-colors"
                  >
                    Open profile
                  </button>
                </div>
              )}

              {canTradeMarket && status !== "connected" && (
                <p className="text-sm text-muted text-center py-4">
                  Connect your wallet to trade this market.
                </p>
              )}

              {canResolve && status === "connected" && (
                <button
                  type="button"
                  onClick={() => void handleResolve()}
                  disabled={isSending || isResolving}
                  className="w-full rounded-xl bg-amber-muted py-3 text-sm font-bold text-amber transition-colors hover:bg-amber/20 disabled:opacity-40"
                >
                  {isResolving ? "Resolving…" : "Resolve with Pyth"}
                </button>
              )}

              {canResolve && status !== "connected" && (
                <p className="text-sm text-muted text-center py-2">
                  Resolution is open — connect a wallet to submit the oracle update.
                </p>
              )}

              {isResolved && canRedeem && (
                <button
                  type="button"
                  onClick={() => void handleRedeem()}
                  disabled={isSending}
                  className="w-full rounded-xl bg-green py-3 text-sm font-bold text-white transition-colors hover:bg-green/80 disabled:opacity-40"
                >
                  {isSending ? "Redeeming…" : `Redeem ${formatSol(redeemPayout)} SOL`}
                </button>
              )}

              {isResolved && !canRedeem && (
                <div
                  className={`rounded-xl py-4 text-center text-sm font-semibold ${
                    outcome ? "bg-green-muted text-green-text" : "bg-red-muted text-red-text"
                  }`}
                >
                  {outcome ? "Yes" : "No"} — market settled
                </div>
              )}
            </div>

            {txStatus && (
              <div className="border-t border-border-low px-4 py-3 bg-bg3/80">
                <p className="text-xs text-muted font-mono break-all">{txStatus}</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function MarketDetailView({ marketAddress }: MarketDetailViewProps): ReactNode {
  const { market, vaultLamports, loading, error, refresh } = useMarketRealtime(marketAddress);

  const loadMarket = useCallback(async () => {
    await refresh();
  }, [refresh]);

  if (loading && !market) {
    return (
      <div className="rounded-2xl border border-border-low bg-bg2 p-10">
        <div className="skeleton h-8 w-2/3 rounded mb-4" />
        <div className="skeleton h-64 w-full rounded-xl mb-4" />
        <div className="skeleton h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="rounded-2xl border border-red/20 bg-red-muted p-8 text-center">
        <p className="text-sm text-red-text mb-4">{error ?? "Market unavailable"}</p>
        <Link href="/" className="text-sm font-medium text-primary hover:underline">
          Back to markets
        </Link>
      </div>
    );
  }

  return (
    <MarketDetailBody
      market={market}
      marketAddress={marketAddress}
      vaultLamports={vaultLamports}
      onRefresh={loadMarket}
    />
  );
}
