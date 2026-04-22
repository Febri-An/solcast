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
import {
  getUserPositionDecoder,
  type UserPosition,
} from "../generated/prediction_market/accounts/userPosition";
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
import { useProfile } from "./use-profile";

const POLL_INTERVAL_MS = 3000;
const STATUS_CLEAR_DELAY_MS = 3000;
/** User-facing default slippage tolerance (1%). */
const DEFAULT_SLIPPAGE_BPS = 100;

export function unwrapOutcome(option: Option<boolean>): boolean | null {
  return isSome(option) ? option.value : null;
}

async function fetchUserPosition(
  marketAddress: Address,
  walletAddress: Address,
): Promise<UserPosition | null> {
  const url = `/api/positions?wallet=${encodeURIComponent(walletAddress)}&market=${encodeURIComponent(marketAddress)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    positions: Array<{ address: string; marketAddress: string; accountDataBase64: string }>;
  };
  const row = payload.positions?.[0];
  if (!row) return null;
  const bytes = Uint8Array.from(atob(row.accountDataBase64), (c) => c.charCodeAt(0));
  return getUserPositionDecoder().decode(bytes);
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
  const { isComplete: isProfileComplete } = useProfile();

  const [tradeAmount, setTradeAmount] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [userPosition, setUserPosition] = useState<UserPosition | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const walletAddress = wallet?.account.address;

  useEffect(() => {
    async function fetchPosition(): Promise<void> {
      if (!walletAddress) {
        setUserPosition(null);
        return;
      }
      try {
        const position = await fetchUserPosition(marketAddress, walletAddress);
        setUserPosition(position);
      } catch (err) {
        console.warn("Failed to fetch user position:", err);
        setUserPosition(null);
      }
    }

    fetchPosition();
    const interval = setInterval(fetchPosition, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [walletAddress, marketAddress]);

  const isResolved = market.resolved;
  const now = Date.now() / 1000;
  const resolutionTime = Number(market.resolutionTime);
  const canTrade = !isResolved && now < resolutionTime;
  const canResolve = !isResolved && now >= resolutionTime;

  const yesShares = market.yesShares;
  const noShares = market.noShares;
  const feeBps = market.feeBps;
  /** Total virtual TVL of the market pool, roughly tracks SOL volume. */
  const totalShares = yesShares + noShares;

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
        setTimeout(() => setTxStatus(null), STATUS_CLEAR_DELAY_MS);
        return;
      }

      try {
        setTxStatus("Building transaction...");
        const amount = BigInt(Math.floor(parseFloat(tradeAmount) * Number(LAMPORTS_PER_SOL)));
        if (amount <= 0n) {
          setTxStatus("Enter an amount greater than zero.");
          return;
        }

        const quote = quoteBuy(yesShares, noShares, amount, buyYes, feeBps);
        if (isTradeError(quote)) {
          setTxStatus(`Quote failed: ${quote}`);
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
        await send({ instructions: [instruction] });

        setTradeAmount("");
        setTxStatus(null);
        onTradeSuccess?.();
        onUpdate?.();
      } catch (err) {
        console.error("Buy failed:", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        setTxStatus(`Error: ${message}`);
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
        const quote = quoteSell(yesShares, noShares, sharesIn, sellYes);
        if (isTradeError(quote)) {
          setTxStatus(`Quote failed: ${quote}`);
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
        await send({ instructions: [instruction] });

        setTxStatus(null);
        onTradeSuccess?.();
        onUpdate?.();
      } catch (err) {
        console.error("Sell failed:", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        setTxStatus(`Error: ${message}`);
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

      const connection = getWeb3Connection();
      const anchorWallet = createAnchorWallet(wallet);

      setTxStatus("Resolving with oracle...");
      const signatures = await resolveMarketWithPyth(
        connection,
        anchorWallet,
        marketAddress,
        market.feedId,
        resolutionTime,
      );

      const lastSig = signatures[signatures.length - 1];
      setTxStatus(`Resolved! ${lastSig?.slice(0, 8)}...`);
      setTimeout(() => setTxStatus(null), STATUS_CLEAR_DELAY_MS);
      onUpdate?.();
    } catch (err) {
      console.error("Resolve failed:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setTxStatus(`Error: ${message}`);
    } finally {
      setIsResolving(false);
    }
  }, [wallet, walletAddress, marketAddress, market.feedId, onUpdate, resolutionTime]);

  const handleRedeem = useCallback(async () => {
    if (!wallet || !walletAddress) return;

    try {
      setTxStatus("Redeeming...");

      const instruction = await getRedeemInstructionAsync({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet adapter vs Codama signer types
        user: wallet.account as any,
        market: marketAddress,
      });

      await send({ instructions: [instruction] });
      setTxStatus(null);
      onRedeemSuccess?.();
      onUpdate?.();
    } catch (err) {
      console.error("Redeem failed:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setTxStatus(`Error: ${message}`);
    }
  }, [wallet, walletAddress, marketAddress, send, onUpdate, onRedeemSuccess]);

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
