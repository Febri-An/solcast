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
import { LAMPORTS_PER_SOL } from "../lib/market-format";
import { syncMarketAndPosition, syncMarketRow } from "../lib/write-through";
import { useToast } from "../components/toast";
import { useProfile } from "./use-profile";
import { useUserPositionRealtime } from "./use-positions-realtime";

const STATUS_CLEAR_DELAY_MS = 3000;
/** User-facing default slippage tolerance (1%). */
const DEFAULT_SLIPPAGE_BPS = 100;

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

  const walletAddress = wallet?.account.address;

  // Subscribe to the user's position via Supabase realtime so buy/sell/redeem
  // reflect the moment the write-through lands (no polling).
  const { position: userPosition } = useUserPositionRealtime(
    walletAddress ?? null,
    marketAddress,
  );

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
  /** Total virtual TVL of the market pool, roughly tracks SOL volume. */
  const totalShares = yesShares + noShares;

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

        // Quote against the best-known pool state: prefer the optimistic
        // overlay if a prior trade just landed (chain-truth for ~500 ms
        // before realtime catches up), else the authoritative market prop.
        const quote = quoteBuy(yesShares, noShares, amount, buyYes, feeBps);
        if (isTradeError(quote)) {
          setTxStatus(`Quote failed: ${quote}`);
          showToast(`Quote failed: ${quote}`, { variant: "error" });
          return;
        }
        const minOut = applySlippage(quote.out, DEFAULT_SLIPPAGE_BPS);

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
        await send({ instructions: [instruction] });

        // Optimistic overlay: the AMM math mirrors on-chain, so our expected
        // pool values should match the confirmed state within 1 lamport.
        setOptimisticOverlay({
          yesShares: quote.newYesShares,
          noShares: quote.newNoShares,
        });

        // Write-through: refresh market + position rows in Supabase so the
        // realtime subscription pushes authoritative numbers across clients.
        void syncMarketAndPosition(marketAddress, walletAddress);

        setTradeAmount("");
        setTxStatus(null);
        showToast(`Buy executed: received ${quote.out.toString()} shares.`);
        onTradeSuccess?.();
        onUpdate?.();
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
      yesShares,
      noShares,
      feeBps,
      send,
      onUpdate,
      isProfileComplete,
      onTradeSuccess,
    ],
  );

  const handleSell = useCallback(
    async (sellYes: boolean, sharesIn: bigint) => {
      if (!wallet || !walletAddress) return;
      if (sharesIn <= 0n) return;

      try {
        setTxStatus("Building transaction...");
        showToast("Preparing sell transaction...", { variant: "loading" });
        // Quote against overlay-aware pool state (see handleBuy for rationale).
        const quote = quoteSell(yesShares, noShares, sharesIn, sellYes);
        if (isTradeError(quote)) {
          setTxStatus(`Quote failed: ${quote}`);
          showToast(`Quote failed: ${quote}`, { variant: "error" });
          return;
        }
        const minSol = applySlippage(quote.out, DEFAULT_SLIPPAGE_BPS);

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
        await send({ instructions: [instruction] });

        // Optimistic overlay: mirror the quote's post-sell pool reserves so
        // the sidebar price moves instantly.
        setOptimisticOverlay({
          yesShares: quote.newYesShares,
          noShares: quote.newNoShares,
        });

        void syncMarketAndPosition(marketAddress, walletAddress);

        setTxStatus(null);
        showToast(`Sell executed: received ${quote.out.toString()} lamports.`);
        onTradeSuccess?.();
        onUpdate?.();
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
      yesShares,
      noShares,
      send,
      onUpdate,
      onTradeSuccess,
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

      await send({ instructions: [instruction] });
      setTxStatus(null);
      showToast("Winnings redeemed successfully.");

      // Redeem zeroes the winning shares and may decrement supply counters
      // on the market. Sync both so the UI reflects the settlement right away.
      void syncMarketAndPosition(marketAddress, walletAddress);

      onRedeemSuccess?.();
      onUpdate?.();
    } catch (err) {
      logTxError("Redeem failed", err);
      const message = formatTxError(err);
      setTxStatus(`Error: ${message}`);
      showToast(`Redeem failed: ${message}`, { variant: "error", durationMs: 5000 });
    }
  }, [wallet, walletAddress, marketAddress, send, onUpdate, onRedeemSuccess, showToast]);

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

  return {
    wallet,
    status,
    isSending,
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
    totalShares,
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
    isProfileComplete,
  };
}
