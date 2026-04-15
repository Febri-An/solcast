"use client";

import { type ReactNode, useCallback, useState } from "react";

import { type Address } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";

import { getClaimWinningsInstructionAsync } from "../generated/prediction_market";
import { useToast } from "./toast";
import { type Market } from "../generated/prediction_market/accounts/market";
import { type UserPosition } from "../generated/prediction_market/accounts/userPosition";

const LAMPORTS_PER_SOL = 1_000_000_000n;

interface PositionCardProps {
  position: UserPosition;
  positionAddress: Address;
  market: Market | null;
  marketAddress: Address;
  onUpdate?: () => void;
  animationDelay?: number;
}

type PositionStatus = "active" | "won" | "lost" | "claimed";

function getPositionStatus(position: UserPosition, market: Market | null): PositionStatus {
  if (!market || !market.resolved) return "active";
  if (position.claimed) return "claimed";

  const outcome = market.outcome;
  if (outcome === null || outcome === undefined) return "active";

  const userWinningBet = outcome ? position.yesAmount : position.noAmount;
  return userWinningBet > 0n ? "won" : "lost";
}

function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / Number(LAMPORTS_PER_SOL);
  if (sol === 0) return "0";
  if (sol < 0.01) return sol.toFixed(4);
  if (sol < 1) return sol.toFixed(3);
  return sol.toFixed(2);
}

function calculateWinnings(
  position: UserPosition,
  market: Market
): { payout: bigint; profit: bigint } | null {
  if (!market.resolved) return null;

  const outcome = market.outcome;
  if (outcome === null || outcome === undefined) return null;

  const userWinningBet = outcome ? position.yesAmount : position.noAmount;
  if (userWinningBet === 0n) return null;

  const winningPool = outcome ? market.yesPool : market.noPool;
  const losingPool = outcome ? market.noPool : market.yesPool;

  const profit = winningPool > 0n ? (userWinningBet * losingPool) / winningPool : 0n;
  const payout = userWinningBet + profit;

  return { payout, profit };
}

function getTimeInfo(market: Market | null): string | null {
  if (!market || market.resolved) return null;

  const now = Date.now() / 1000;
  const resolutionTime = Number(market.resolutionTime);
  const diff = resolutionTime - now;

  if (diff <= 0) return "Pending resolution";
  if (diff < 60) return `${Math.floor(diff)}s left`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m left`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h left`;
  return `${Math.floor(diff / 86400)}d left`;
}

export function PositionCard({
  position,
  market,
  marketAddress,
  onUpdate,
  animationDelay = 0,
}: PositionCardProps): ReactNode {
  const { wallet } = useWalletConnection();
  const { send, isSending } = useSendTransaction();
  const { showToast } = useToast();
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const status = getPositionStatus(position, market);
  const winnings = market ? calculateWinnings(position, market) : null;

  const handleClaim = useCallback(async () => {
    if (!wallet) return;

    try {
      setTxStatus("Claiming...");

      const instruction = await getClaimWinningsInstructionAsync({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet adapter vs Codama signer types
        user: wallet.account as any,
        market: marketAddress,
      });

      await send({ instructions: [instruction] });
      setTxStatus(null);
      showToast("Winnings claimed successfully.");
      onUpdate?.();
    } catch (err) {
      console.error("Claim failed:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setTxStatus(`Error: ${message}`);
    }
  }, [wallet, marketAddress, send, onUpdate, showToast]);

  const statusConfig: Record<PositionStatus, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-primary/10 text-primary" },
    won: { label: "Won", className: "bg-green-muted text-green-text" },
    lost: { label: "Lost", className: "bg-red-muted text-red-text" },
    claimed: { label: "Claimed", className: "bg-bg3 text-muted" },
  };

  const { label, className: badgeClass } = statusConfig[status];
  const timeInfo = getTimeInfo(market);

  return (
    <div
      className="animate-fade-in rounded-2xl border border-border-low bg-bg2 overflow-hidden transition-colors hover:bg-card-hover"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium leading-snug truncate text-foreground">
              {market?.question ?? "Unknown Market"}
            </h3>
            {timeInfo && (
              <p className="text-xs text-muted mt-0.5">{timeInfo}</p>
            )}
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badgeClass}`}>
            {label}
          </span>
        </div>

        <div className="flex flex-wrap gap-3 mb-3">
          {position.yesAmount > 0n && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-green-muted text-green-text text-xs font-bold">
                Y
              </span>
              <span className="font-mono text-sm text-foreground-secondary">
                {formatSol(position.yesAmount)} SOL
              </span>
            </div>
          )}
          {position.noAmount > 0n && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-muted text-red-text text-xs font-bold">
                N
              </span>
              <span className="font-mono text-sm text-foreground-secondary">
                {formatSol(position.noAmount)} SOL
              </span>
            </div>
          )}
        </div>

        {market?.resolved && (
          <div className="text-sm">
            <div className="flex items-center gap-2 text-muted">
              <span>
                Outcome:{" "}
                <span className={`font-medium ${market.outcome ? "text-green-text" : "text-red-text"}`}>
                  {market.outcome ? "YES" : "NO"}
                </span>
              </span>
              {winnings && (
                <>
                  <span className="text-border-strong">|</span>
                  <span>
                    {status === "won" || status === "claimed" ? (
                      <>
                        Payout:{" "}
                        <span className="font-mono font-medium text-green-text">
                          {formatSol(winnings.payout)} SOL
                        </span>
                        <span className="text-green-text/70 ml-1">
                          (+{formatSol(winnings.profit)})
                        </span>
                      </>
                    ) : (
                      <span className="text-red-text">
                        Lost {formatSol(position.yesAmount + position.noAmount)} SOL
                      </span>
                    )}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {status === "won" && !position.claimed && (
        <div className="border-t border-border-low p-3 bg-green-muted">
          <button
            onClick={handleClaim}
            disabled={isSending}
            className="w-full rounded-xl bg-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green/80 disabled:opacity-50"
          >
            {isSending ? "Claiming..." : `Claim ${formatSol(winnings?.payout ?? 0n)} SOL`}
          </button>
        </div>
      )}

      {txStatus && (
        <div className="border-t border-border-low px-4 py-2.5 text-xs text-muted font-mono bg-bg3/50">
          {txStatus}
        </div>
      )}
    </div>
  );
}
