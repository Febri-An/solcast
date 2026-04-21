"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { type Address, type Option, isSome } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";

import {
  getClaimWinningsInstructionAsync,
  getPlaceBetInstructionAsync,
  type Market,
} from "../generated/prediction_market";
import { resolveMarketWithPyth } from "../lib/pyth";
import { createAnchorWallet, getWeb3Connection } from "../lib/solana-compat";
import {
  getUserPositionDecoder,
  type UserPosition,
} from "../generated/prediction_market/accounts/userPosition";

import { LAMPORTS_PER_SOL } from "../lib/market-format";
import { useProfile } from "./use-profile";

const POLL_INTERVAL_MS = 3000;
const STATUS_CLEAR_DELAY_MS = 3000;

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
  /** Called after a bet transaction succeeds (signature received). */
  onPlaceBetSuccess?: () => void;
  /** Called after claim winnings transaction succeeds. */
  onClaimSuccess?: () => void;
}

export function useMarketTrading(
  market: Market,
  marketAddress: Address,
  onUpdate?: () => void,
  options?: UseMarketTradingOptions,
) {
  const onPlaceBetSuccess = options?.onPlaceBetSuccess;
  const onClaimSuccess = options?.onClaimSuccess;
  const { wallet, status } = useWalletConnection();
  const { send, isSending } = useSendTransaction();
  const { isComplete: isProfileComplete } = useProfile();

  const [betAmount, setBetAmount] = useState("");
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
  const canBet = !isResolved && now < resolutionTime;
  const canResolve = !isResolved && now >= resolutionTime;

  const totalPool = market.yesPool + market.noPool;
  const yesPercent = totalPool > 0n ? Number((market.yesPool * 100n) / totalPool) : 50;
  const noPercent = 100 - yesPercent;

  const handlePlaceBet = useCallback(
    async (betYes: boolean) => {
      if (!wallet || !walletAddress || !betAmount) return;
      if (!isProfileComplete) {
        setTxStatus("Set a username in your profile before betting.");
        setTimeout(() => setTxStatus(null), STATUS_CLEAR_DELAY_MS);
        return;
      }

      try {
        setTxStatus("Building transaction...");
        const amount = BigInt(Math.floor(parseFloat(betAmount) * Number(LAMPORTS_PER_SOL)));

        const instruction = await getPlaceBetInstructionAsync({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet adapter vs Codama signer types
          user: wallet.account as any,
          market: marketAddress,
          amount,
          betYes,
        });

        setTxStatus("Awaiting signature...");
        await send({ instructions: [instruction] });

        setBetAmount("");
        setTxStatus(null);
        onPlaceBetSuccess?.();
        onUpdate?.();
      } catch (err) {
        console.error("Place bet failed:", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        setTxStatus(`Error: ${message}`);
      }
    },
    [wallet, walletAddress, marketAddress, betAmount, send, onUpdate, isProfileComplete, onPlaceBetSuccess],
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

  const handleClaim = useCallback(async () => {
    if (!wallet || !walletAddress) return;

    try {
      setTxStatus("Claiming...");

      const instruction = await getClaimWinningsInstructionAsync({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet adapter vs Codama signer types
        user: wallet.account as any,
        market: marketAddress,
      });

      await send({ instructions: [instruction] });
      setTxStatus(null);
      onClaimSuccess?.();
      onUpdate?.();
    } catch (err) {
      console.error("Claim failed:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setTxStatus(`Error: ${message}`);
    }
  }, [wallet, walletAddress, marketAddress, send, onUpdate, onClaimSuccess]);

  const canClaim = useMemo(() => {
    if (status !== "connected" || !isResolved || !userPosition || userPosition.claimed) {
      return false;
    }
    const outcome = unwrapOutcome(market.outcome);
    if (outcome === null) return false;
    const winBet = outcome ? userPosition.yesAmount : userPosition.noAmount;
    return winBet > 0n;
  }, [status, isResolved, userPosition, market.outcome]);

  const claimPayout = useMemo(() => {
    if (!isResolved || !userPosition) return 0n;
    const outcome = unwrapOutcome(market.outcome);
    if (outcome === null) return 0n;
    const winBet = outcome ? userPosition.yesAmount : userPosition.noAmount;
    if (winBet === 0n) return 0n;
    const winPool = outcome ? market.yesPool : market.noPool;
    const losePool = outcome ? market.noPool : market.yesPool;
    return winBet + (winPool > 0n ? (winBet * losePool) / winPool : 0n);
  }, [isResolved, userPosition, market]);

  return {
    wallet,
    status,
    isSending,
    betAmount,
    setBetAmount,
    txStatus,
    userPosition,
    isResolving,
    walletAddress,
    isResolved,
    resolutionTime,
    canBet,
    canResolve,
    totalPool,
    yesPercent,
    noPercent,
    handlePlaceBet,
    handleResolve,
    handleClaim,
    canClaim,
    claimPayout,
    isProfileComplete,
  };
}
