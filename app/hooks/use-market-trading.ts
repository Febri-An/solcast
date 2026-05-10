"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { type Address, type Option, isSome } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";

import {
  getBuyInstructionAsync,
  getRedeemInstructionAsync,
  getSellInstructionAsync,
  type Market,
} from "../generated/prediction_market";
import { resolveMarketWithPyth } from "../lib/pyth";
import { createAnchorWallet, getWeb3Connection } from "../lib/solana-compat";
import {
  applySlippage,
  isTradeError,
  quoteBuy,
  quoteSell,
  yesPriceBps,
} from "../lib/amm-math";
import { fetchMarketReservesConfirmed } from "../lib/fetch-market-reserves-client";
import { computeDynamicSlippageBps } from "../lib/trade-slippage";
import { isProbablySlippageExceededError } from "../lib/trade-tx-errors";
import { LAMPORTS_PER_SOL } from "../lib/market-format";
import {
  fetchPositionMetrics,
  recordPositionFill,
  syncMarketRow,
  syncPositionCacheAfterTx,
} from "../lib/write-through";
import { useToast } from "../components/toast";
import { useProfile } from "./use-profile";
import { useUserPositionRealtime } from "./use-positions-realtime";

const STATUS_CLEAR_DELAY_MS = 3000;
const TRADE_ATTEMPTS = 3;
/** Extra delay before refetch/re-sign after a simulation slippage miss. */
const TRADE_RETRY_BASE_DELAY_MS = 400;

/** User cap for dynamic slippage (basis points); stored in localStorage. */
export const TRADE_MAX_SLIPPAGE_STORAGE_KEY =
  "prediction_market_trade_slippage_max_bps";

/** Presets for sidebar — caps the dynamic curve (not a literal fixed 5% dump). */
export const TRADE_MAX_SLIPPAGE_OPTIONS: ReadonlyArray<{ bps: number; label: string }> = [
  { bps: 200, label: "2% max" },
  { bps: 250, label: "2.5% max" },
  { bps: 300, label: "3% max" },
  { bps: 400, label: "4% max" },
  { bps: 500, label: "5% max" },
];

export function unwrapOutcome(option: Option<boolean>): boolean | null {
  return isSome(option) ? option.value : null;
}

/**
 * @solana/kit wraps on-chain failures in a `SolanaError` whose `.message` is a
 * generic "transaction plan failed" string. The real root cause (program logs,
 * custom error code, RPC response) lives on `err.cause` and `err.context`.
 * This helper walks the chain and returns a message useful for the UI.
 */
function formatTxError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 6) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const context = (cur as unknown as { context?: unknown }).context;
      if (context && typeof context === "object") {
        const ctx = context as {
          code?: number;
          logs?: string[];
          errorName?: string;
          errorMessage?: string;
          __code?: number;
        };
        if (ctx.errorName) parts.push(`(${ctx.errorName})`);
        if (ctx.errorMessage) parts.push(ctx.errorMessage);
        if (typeof ctx.code === "number") parts.push(`code=${ctx.code}`);
        if (Array.isArray(ctx.logs) && ctx.logs.length > 0) {
          const last = ctx.logs[ctx.logs.length - 1];
          if (last) parts.push(`log: ${last}`);
        }
      }
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
    depth++;
  }
  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const unique = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return unique.join(" · ").slice(0, 400);
}

/** Dump the full error chain to the console for devtools debugging. */
function logTxError(label: string, err: unknown) {
  console.group(label);
  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 6) {
    console.error(`[depth ${depth}]`, cur);
    if (cur instanceof Error) {
      const ctx = (cur as unknown as { context?: unknown }).context;
      if (ctx) console.error(`[depth ${depth}] context:`, ctx);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      break;
    }
    depth++;
  }
  console.groupEnd();
}

/**
 * Optimistic overlay applied after sign but before the write-through lands.
 * When the DB push arrives (or a second later via the keeper's reconcile),
 * the overlay is cleared and the sidebar shows authoritative numbers.
 */
interface OptimisticOverlay {
  yesShares: bigint;
  noShares: bigint;
}

export interface UseMarketTradingOptions {
  /** Called after a successful buy/sell transaction. */
  onTradeSuccess?: () => void;
  /** Called after a successful redeem transaction. */
  onRedeemSuccess?: () => void;
}

export function useMarketTrading(
  market: Market,
  marketAddress: Address,
  onUpdate?: () => void,
  options?: UseMarketTradingOptions,
) {
  const onTradeSuccess = options?.onTradeSuccess;
  const onRedeemSuccess = options?.onRedeemSuccess;
  const { wallet, status } = useWalletConnection();
  const { send, isSending } = useSendTransaction();
  const { showToast } = useToast();
  const { isComplete: isProfileComplete } = useProfile();

  const [tradeAmount, setTradeAmount] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [optimisticOverlay, setOptimisticOverlay] =
    useState<OptimisticOverlay | null>(null);
  const [yesCostBasisLamports, setYesCostBasisLamports] = useState(0n);
  const [noCostBasisLamports, setNoCostBasisLamports] = useState(0n);
  const [realizedPnlLamports, setRealizedPnlLamports] = useState(0n);

  /** Ceiling (bps) passed into `computeDynamicSlippageBps` — default 4%. */
  const [tradeMaxSlippageBps, setTradeMaxSlippageBpsState] = useState(400);

  const walletAddress = wallet?.account.address;

  const refreshPositionMetrics = useCallback(async () => {
    if (!walletAddress) {
      setYesCostBasisLamports(0n);
      setNoCostBasisLamports(0n);
      setRealizedPnlLamports(0n);
      return;
    }
    const row = await fetchPositionMetrics(walletAddress, marketAddress);
    if (!row) {
      setYesCostBasisLamports(0n);
      setNoCostBasisLamports(0n);
      setRealizedPnlLamports(0n);
      return;
    }
    try {
      setYesCostBasisLamports(BigInt(row.yes_cost_basis_lamports ?? "0"));
      setNoCostBasisLamports(BigInt(row.no_cost_basis_lamports ?? "0"));
      setRealizedPnlLamports(BigInt(row.realized_pnl_lamports ?? "0"));
    } catch {
      setYesCostBasisLamports(0n);
      setNoCostBasisLamports(0n);
      setRealizedPnlLamports(0n);
    }
  }, [walletAddress, marketAddress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(TRADE_MAX_SLIPPAGE_STORAGE_KEY);
      if (!raw) return;
      const n = Number.parseInt(raw, 10);
      if (!Number.isNaN(n) && n >= 150 && n <= 500)
        setTradeMaxSlippageBpsState(n);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshPositionMetrics();
  }, [refreshPositionMetrics]);

  const setTradeMaxSlippageBps = useCallback((bps: number) => {
    setTradeMaxSlippageBpsState(bps);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TRADE_MAX_SLIPPAGE_STORAGE_KEY, String(bps));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Subscribe to the user's position via Supabase realtime so buy/sell/redeem
  // reflect the moment the write-through lands (no polling).
  const { position: userPosition, refresh: refreshCachedUserPosition } =
    useUserPositionRealtime(walletAddress ?? null, marketAddress);

  /**
   * RPC → POST sync-one writes fresh account bytes into `positions_cache`. We must
   * await that plus re-fetch locally; relying only on realtime is flaky (race,
   * missed WS events), which leaves stale share counts after sell/redeem.
   */
  const hydratePositionCacheAfterTrade = useCallback(async () => {
    const w = walletAddress ?? "";
    if (!w) return;
    await syncPositionCacheAfterTx(String(marketAddress), w, refreshCachedUserPosition);
    await refreshPositionMetrics();
  }, [
    walletAddress,
    marketAddress,
    refreshCachedUserPosition,
    refreshPositionMetrics,
  ]);

  const isResolved = market.resolved;
  const now = Date.now() / 1000;
  const resolutionTime = Number(market.resolutionTime);
  const canTrade = !isResolved && now < resolutionTime;
  const canResolve = !isResolved && now >= resolutionTime;

  // Effective pool values: on optimistic state override the market numbers so
  // the sidebar price moves instantly after a click. The overlay is cleared
  // whenever the real market prop changes (the realtime hook will re-render
  // this component with fresh values once the write-through lands).
  const yesShares = optimisticOverlay?.yesShares ?? market.yesShares;
  const noShares = optimisticOverlay?.noShares ?? market.noShares;
  const feeBps = market.feeBps;

  // Clear the optimistic overlay whenever the authoritative market state
  // changes — i.e. the realtime push / refresh has landed, so we now have
  // chain-truth numbers in `market`. As a safety belt we also auto-clear
  // after 6 s in case the push never arrives (network hiccup, misconfig).
  useEffect(() => {
    if (!optimisticOverlay) return;
    setOptimisticOverlay(null);
    // Intentionally only responding to the market prop identity changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);

  useEffect(() => {
    if (!optimisticOverlay) return;
    const timer = setTimeout(() => setOptimisticOverlay(null), 6000);
    return () => clearTimeout(timer);
  }, [optimisticOverlay]);

  /** Current implied probability of YES in basis points (0..10000). */
  const yesBps = useMemo(
    () => yesPriceBps(yesShares, noShares),
    [yesShares, noShares],
  );
  const yesPercent = yesBps / 100;
  const noPercent = 100 - yesPercent;

  /** Live quote for the user's current tradeAmount input. */
  const quoteForBuy = useCallback(
    (buyYes: boolean) => {
      if (!tradeAmount) return null;
      const amount = BigInt(Math.floor(parseFloat(tradeAmount) * Number(LAMPORTS_PER_SOL)));
      if (amount <= 0n) return null;
      const q = quoteBuy(yesShares, noShares, amount, buyYes, feeBps);
      return isTradeError(q) ? null : q;
    },
    [tradeAmount, yesShares, noShares, feeBps],
  );

  const handleBuy = useCallback(
    async (buyYes: boolean) => {
      if (!wallet || !walletAddress || !tradeAmount) return;
      if (!isProfileComplete) {
        setTxStatus("Set a username in your profile before trading.");
        showToast("Set a username in your profile before trading.", {
          variant: "error",
        });
        setTimeout(() => setTxStatus(null), STATUS_CLEAR_DELAY_MS);
        return;
      }

      try {
        setTxStatus("Building transaction...");
        showToast("Preparing buy transaction...", { variant: "loading" });
        const amount = BigInt(Math.floor(parseFloat(tradeAmount) * Number(LAMPORTS_PER_SOL)));
        if (amount <= 0n) {
          setTxStatus("Enter an amount greater than zero.");
          showToast("Enter an amount greater than zero.", { variant: "error" });
          return;
        }

        for (let attempt = 0; attempt < TRADE_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            setTxStatus("Refreshing quote after slippage miss…");
            showToast(`Pool moved — refreshing quote (${attempt + 1}/${TRADE_ATTEMPTS})…`, {
              variant: "loading",
            });
            await new Promise((r) =>
              setTimeout(r, TRADE_RETRY_BASE_DELAY_MS * attempt),
            );
          }

          const reserves = await fetchMarketReservesConfirmed(marketAddress);
          if (!reserves) {
            setTxStatus("Could not read market pool from RPC.");
            showToast("Market account not found — check RPC / cluster.", {
              variant: "error",
            });
            return;
          }

          const quote = quoteBuy(
            reserves.yesShares,
            reserves.noShares,
            amount,
            buyYes,
            reserves.feeBps,
          );
          if (isTradeError(quote)) {
            setTxStatus(`Quote failed: ${quote}`);
            showToast(`Quote failed: ${quote}`, { variant: "error" });
            return;
          }

          const poolTotal = reserves.yesShares + reserves.noShares;
          const slippageBps = computeDynamicSlippageBps({
            poolTotal,
            maxCapBps: tradeMaxSlippageBps,
            amountIn: amount,
          });
          const minOut = applySlippage(quote.out, slippageBps);

          const instruction = await getBuyInstructionAsync({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet adapter vs Codama signer types
            user: wallet.account as any,
            market: marketAddress,
            amountIn: amount,
            buyYes,
            minSharesOut: minOut,
          });

          setTxStatus("Awaiting signature...");
          showToast("Awaiting wallet signature...", { variant: "loading" });
          let sendResult: unknown;

          try {
            sendResult = await send({ instructions: [instruction] });
          } catch (sendErr) {
            if (
              attempt < TRADE_ATTEMPTS - 1 &&
              isProbablySlippageExceededError(sendErr)
            ) {
              logTxError(`Buy attempt ${attempt + 1} (slippage)`, sendErr);
              continue;
            }
            throw sendErr;
          }

          setOptimisticOverlay({
            yesShares: quote.newYesShares,
            noShares: quote.newNoShares,
          });
          const txSignature = typeof sendResult === "string" ? sendResult : undefined;
          await recordPositionFill({
            clientFillId: crypto.randomUUID(),
            txSignature,
            wallet: walletAddress,
            market: marketAddress,
            side: buyYes ? "buy_yes" : "buy_no",
            sharesDelta: quote.out,
            lamportsDelta: amount,
          });
          await hydratePositionCacheAfterTrade();
          setTradeAmount("");
          setTxStatus(null);
          showToast(`Buy executed: received ${quote.out.toString()} shares.`);
          onTradeSuccess?.();
          onUpdate?.();
          return;
        }
      } catch (err) {
        logTxError("Buy failed", err);
        const message = formatTxError(err);
        setTxStatus(`Error: ${message}`);
        showToast(`Buy failed: ${message}`, { variant: "error", durationMs: 5000 });
        setOptimisticOverlay(null);
      }
    },
    [
      wallet,
      walletAddress,
      marketAddress,
      tradeAmount,
      send,
      onUpdate,
      isProfileComplete,
      onTradeSuccess,
      tradeMaxSlippageBps,
      showToast,
      hydratePositionCacheAfterTrade,
    ],
  );

  const handleSell = useCallback(
    async (sellYes: boolean, sharesIn: bigint) => {
      if (!wallet || !walletAddress) return;
      if (sharesIn <= 0n) return;

      try {
        setTxStatus("Building transaction...");
        showToast("Preparing sell transaction...", { variant: "loading" });

        for (let attempt = 0; attempt < TRADE_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            setTxStatus("Refreshing quote after slippage miss…");
            showToast(`Pool moved — refreshing quote (${attempt + 1}/${TRADE_ATTEMPTS})…`, {
              variant: "loading",
            });
            await new Promise((r) =>
              setTimeout(r, TRADE_RETRY_BASE_DELAY_MS * attempt),
            );
          }

          const reserves = await fetchMarketReservesConfirmed(marketAddress);
          if (!reserves) {
            setTxStatus("Could not read market pool from RPC.");
            showToast("Market account not found — check RPC / cluster.", {
              variant: "error",
            });
            return;
          }

          const quote = quoteSell(
            reserves.yesShares,
            reserves.noShares,
            sharesIn,
            sellYes,
          );
          if (isTradeError(quote)) {
            setTxStatus(`Quote failed: ${quote}`);
            showToast(`Quote failed: ${quote}`, { variant: "error" });
            return;
          }

          const poolTotal = reserves.yesShares + reserves.noShares;
          const slippageBps = computeDynamicSlippageBps({
            poolTotal,
            maxCapBps: tradeMaxSlippageBps,
            sharesIn,
          });
          const minSol = applySlippage(quote.out, slippageBps);

          const instruction = await getSellInstructionAsync({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet adapter vs Codama signer types
            user: wallet.account as any,
            market: marketAddress,
            sharesIn,
            sellYes,
            minSolOut: minSol,
          });

          setTxStatus("Awaiting signature...");
          showToast("Awaiting wallet signature...", { variant: "loading" });
          let sendResult: unknown;

          try {
            sendResult = await send({ instructions: [instruction] });
          } catch (sendErr) {
            if (
              attempt < TRADE_ATTEMPTS - 1 &&
              isProbablySlippageExceededError(sendErr)
            ) {
              logTxError(`Sell attempt ${attempt + 1} (slippage)`, sendErr);
              continue;
            }
            throw sendErr;
          }

          setOptimisticOverlay({
            yesShares: quote.newYesShares,
            noShares: quote.newNoShares,
          });
          const txSignature = typeof sendResult === "string" ? sendResult : undefined;
          await recordPositionFill({
            clientFillId: crypto.randomUUID(),
            txSignature,
            wallet: walletAddress,
            market: marketAddress,
            side: sellYes ? "sell_yes" : "sell_no",
            sharesDelta: sharesIn,
            lamportsDelta: quote.out,
          });
          await hydratePositionCacheAfterTrade();
          setTxStatus(null);
          showToast(`Sell executed: received ${quote.out.toString()} lamports.`);
          onTradeSuccess?.();
          onUpdate?.();
          return;
        }
      } catch (err) {
        logTxError("Sell failed", err);
        const message = formatTxError(err);
        setTxStatus(`Error: ${message}`);
        showToast(`Sell failed: ${message}`, { variant: "error", durationMs: 5000 });
        setOptimisticOverlay(null);
      }
    },
    [
      wallet,
      walletAddress,
      marketAddress,
      send,
      onUpdate,
      onTradeSuccess,
      tradeMaxSlippageBps,
      showToast,
      hydratePositionCacheAfterTrade,
    ],
  );

  const handleResolve = useCallback(async () => {
    if (!wallet || !walletAddress) return;

    try {
      setIsResolving(true);
      setTxStatus("Fetching Pyth price...");
      showToast("Fetching oracle price...", { variant: "loading" });

      const connection = getWeb3Connection();
      const anchorWallet = createAnchorWallet(wallet);

      setTxStatus("Resolving with oracle...");
      showToast("Resolving market on-chain...", { variant: "loading" });
      const signatures = await resolveMarketWithPyth(
        connection,
        anchorWallet,
        marketAddress,
        market.feedId,
        resolutionTime,
      );

      const lastSig = signatures[signatures.length - 1];
      setTxStatus(`Resolved! ${lastSig?.slice(0, 8)}...`);
      showToast(`Market resolved (${lastSig?.slice(0, 8)}...)`);

      void syncMarketRow(marketAddress);

      setTimeout(() => setTxStatus(null), STATUS_CLEAR_DELAY_MS);
      onUpdate?.();
    } catch (err) {
      logTxError("Resolve failed", err);
      const message = formatTxError(err);
      setTxStatus(`Error: ${message}`);
      showToast(`Resolve failed: ${message}`, { variant: "error", durationMs: 5000 });
    } finally {
      setIsResolving(false);
    }
  }, [wallet, walletAddress, marketAddress, market.feedId, onUpdate, resolutionTime, showToast]);

  const handleRedeem = useCallback(async () => {
    if (!wallet || !walletAddress) return;

    try {
      setTxStatus("Redeeming...");
      showToast("Redeeming winnings...", { variant: "loading" });

      const instruction = await getRedeemInstructionAsync({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet adapter vs Codama signer types
        user: wallet.account as any,
        market: marketAddress,
      });

      await send({ instructions: [instruction] }, { commitment: "confirmed" });

      await hydratePositionCacheAfterTrade();

      setTxStatus(null);
      showToast("Winnings redeemed successfully.");

      onRedeemSuccess?.();
      onUpdate?.();
    } catch (err) {
      logTxError("Redeem failed", err);
      const message = formatTxError(err);
      setTxStatus(`Error: ${message}`);
      showToast(`Redeem failed: ${message}`, { variant: "error", durationMs: 5000 });
    }
  }, [
    wallet,
    walletAddress,
    marketAddress,
    send,
    onUpdate,
    onRedeemSuccess,
    showToast,
    hydratePositionCacheAfterTrade,
  ]);

  const canRedeem = useMemo(() => {
    if (status !== "connected" || !isResolved || !userPosition) return false;
    const outcome = unwrapOutcome(market.outcome);
    if (outcome === null) return false;
    const winningShares = outcome ? userPosition.yesShares : userPosition.noShares;
    return winningShares > 0n;
  }, [status, isResolved, userPosition, market.outcome]);

  /** Winning-side shares redeem 1:1 in lamports. */
  const redeemPayout = useMemo(() => {
    if (!isResolved || !userPosition) return 0n;
    const outcome = unwrapOutcome(market.outcome);
    if (outcome === null) return 0n;
    return outcome ? userPosition.yesShares : userPosition.noShares;
  }, [isResolved, userPosition, market.outcome]);

  /** Estimated SOL out if user sells all YES shares at current pool state. */
  const estimatedYesExitLamports = useMemo(() => {
    if (!userPosition || userPosition.yesShares <= 0n) return 0n;
    const q = quoteSell(yesShares, noShares, userPosition.yesShares, true);
    return isTradeError(q) ? 0n : q.out;
  }, [userPosition, yesShares, noShares]);

  /** Estimated SOL out if user sells all NO shares at current pool state. */
  const estimatedNoExitLamports = useMemo(() => {
    if (!userPosition || userPosition.noShares <= 0n) return 0n;
    const q = quoteSell(yesShares, noShares, userPosition.noShares, false);
    return isTradeError(q) ? 0n : q.out;
  }, [userPosition, yesShares, noShares]);

  /** Raw cost basis from Supabase (can briefly lag on-chain share counts). */
  const rawNetInvestedLamports = useMemo(
    () => yesCostBasisLamports + noCostBasisLamports,
    [yesCostBasisLamports, noCostBasisLamports],
  );

  const hasOpenShares = useMemo(() => {
    if (!userPosition) return false;
    return userPosition.yesShares > 0n || userPosition.noShares > 0n;
  }, [userPosition]);

  const netInvestedLamports = useMemo(() => {
    if (!hasOpenShares) return 0n;
    return rawNetInvestedLamports;
  }, [hasOpenShares, rawNetInvestedLamports]);

  const estimatedExitLamports = useMemo(
    () => estimatedYesExitLamports + estimatedNoExitLamports,
    [estimatedYesExitLamports, estimatedNoExitLamports],
  );

  const unrealizedPnlLamports = useMemo(() => {
    if (!hasOpenShares) return 0n;
    // Until Supabase cost basis catches `recordPositionFill`, don't treat exit value as PnL.
    if (rawNetInvestedLamports === 0n) return 0n;
    return estimatedExitLamports - netInvestedLamports;
  }, [
    hasOpenShares,
    rawNetInvestedLamports,
    estimatedExitLamports,
    netInvestedLamports,
  ]);

  const isCostBasisIncomplete = useMemo(() => {
    if (!userPosition) return false;
    const hasShares = userPosition.yesShares > 0n || userPosition.noShares > 0n;
    return hasShares && rawNetInvestedLamports === 0n;
  }, [userPosition, rawNetInvestedLamports]);

  return {
    wallet,
    status,
    isSending,
    tradeMaxSlippageBps,
    setTradeMaxSlippageBps,
    tradeAmount,
    setTradeAmount,
    txStatus,
    userPosition,
    isResolving,
    walletAddress,
    isResolved,
    resolutionTime,
    canTrade,
    canResolve,
    yesShares,
    noShares,
    yesBps,
    yesPercent,
    noPercent,
    quoteForBuy,
    handleBuy,
    handleSell,
    handleResolve,
    handleRedeem,
    canRedeem,
    redeemPayout,
    estimatedYesExitLamports,
    estimatedNoExitLamports,
    yesCostBasisLamports,
    noCostBasisLamports,
    netInvestedLamports,
    realizedPnlLamports,
    unrealizedPnlLamports,
    isCostBasisIncomplete,
    isProfileComplete,
  };
}
