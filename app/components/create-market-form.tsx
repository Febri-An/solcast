"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";

import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";

import { getCreateMarketInstructionAsync } from "../generated/prediction_market";
import { useProfile } from "../hooks/use-profile";

interface CreateMarketFormProps {
  onCreated?: () => void;
}

const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;

interface PriceFeed {
  label: string;
  symbol: string;
  feedId: string;
}

const PRICE_FEEDS: PriceFeed[] = [
  {
    label: "Bitcoin",
    symbol: "BTC",
    feedId:
      "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  },
  {
    label: "Solana",
    symbol: "SOL",
    feedId:
      "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  },
  {
    label: "Ethereum",
    symbol: "ETH",
    feedId:
      "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  },
];

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

export function CreateMarketForm({
  onCreated,
}: CreateMarketFormProps): ReactNode {
  const { wallet, status } = useWalletConnection();
  const { send, isSending } = useSendTransaction();
  const { isComplete: isProfileComplete, configured, openProfileModal } = useProfile();

  const [selectedFeed, setSelectedFeed] = useState(PRICE_FEEDS[0].feedId);
  const [targetPrice, setTargetPrice] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("5");
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const walletAddress = wallet?.account.address;

  const feed = useMemo(
    () => PRICE_FEEDS.find((f) => f.feedId === selectedFeed) ?? PRICE_FEEDS[0],
    [selectedFeed],
  );

  const priceNum = parseFloat(targetPrice);
  const isValidPrice = !isNaN(priceNum) && priceNum > 0;

  const question = isValidPrice
    ? `Will ${feed.symbol} be above $${formatUsd(priceNum)}?`
    : "";

  const handleCreate = useCallback(async () => {
    if (!wallet || !walletAddress || !isValidPrice) return;
    if (configured && !isProfileComplete) {
      setTxStatus("Set a username in your profile before creating a market.");
      return;
    }

    try {
      setTxStatus("Creating market...");

      const marketId = BigInt(Date.now());
      const nowInSeconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
      const durationInSeconds = parseInt(durationMinutes) * SECONDS_PER_MINUTE;
      const resolutionTime = BigInt(nowInSeconds + durationInSeconds);

      const feedIdBytes = hexToBytes(feed.feedId);

      const instruction = await getCreateMarketInstructionAsync({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet adapter vs Codama signer types
        creator: wallet.account as any,
        marketId,
        question,
        resolutionTime,
        feedId: feedIdBytes,
        targetPrice: BigInt(Math.floor(priceNum)),
      });

      await send({ instructions: [instruction] });

      setSelectedFeed(PRICE_FEEDS[0].feedId);
      setTargetPrice("");
      setDurationMinutes("5");
      setTxStatus(null);
      onCreated?.();
    } catch (err) {
      console.error("Create market failed:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setTxStatus(`Error: ${message}`);
    }
  }, [
    wallet,
    walletAddress,
    isValidPrice,
    durationMinutes,
    feed,
    question,
    priceNum,
    send,
    onCreated,
    configured,
    isProfileComplete,
  ]);

  if (status !== "connected") {
    return (
      <div className="rounded-2xl border border-border-low bg-bg2 p-6 text-center">
        <p className="text-sm text-muted">
          Connect your wallet to create a market
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border-low bg-bg2 overflow-hidden animate-fade-in">
      <div className="px-5 py-4 border-b border-border-low">
        <h3 className="text-sm font-semibold text-foreground">Create New Market</h3>
        <p className="text-xs text-muted mt-0.5">Set up a price prediction market powered by Pyth oracles</p>
      </div>

      <div className="p-5 space-y-4">
        {configured && !isProfileComplete && (
          <div className="rounded-xl border border-amber/25 bg-amber-muted/50 px-4 py-3 text-sm text-amber">
            <p className="font-medium text-foreground">Username required</p>
            <p className="mt-1 text-xs text-muted leading-relaxed">
              Choose a unique username in your profile to create markets and place bets.
            </p>
            <button
              type="button"
              onClick={() => openProfileModal("username")}
              className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover transition-colors"
            >
              Open profile settings
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1.5">
              Asset
            </label>
            <select
              value={selectedFeed}
              onChange={(e) => setSelectedFeed(e.target.value)}
              disabled={isSending}
              className="w-full rounded-lg border border-border-low bg-bg3 px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
            >
              {PRICE_FEEDS.map((f) => (
                <option key={f.feedId} value={f.feedId}>
                  {f.label} ({f.symbol}/USD)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1.5">
              Target Price (USD)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 80000"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              disabled={isSending}
              className="w-full rounded-lg border border-border-low bg-bg3 px-3 py-2.5 text-sm font-mono text-foreground outline-none placeholder:text-muted/50 transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
            />
          </div>
        </div>

        {question && (
          <div className="rounded-lg bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-xs text-muted mb-1">Market question</p>
            <p className="text-sm font-semibold text-foreground">{question}</p>
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-foreground-secondary mb-1.5">
              Duration
            </label>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              disabled={isSending}
              className="w-full rounded-lg border border-border-low bg-bg3 px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
            >
              <option value="2">2 minutes</option>
              <option value="5">5 minutes</option>
              <option value="60">1 hour</option>
              <option value="1440">1 day</option>
              <option value="10080">1 week</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={isSending || !isValidPrice || (configured && !isProfileComplete)}
            className="rounded-lg bg-primary px-8 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {isSending ? "Creating..." : "Create Market"}
          </button>
        </div>

        {txStatus && (
          <p className="text-xs text-muted font-mono">{txStatus}</p>
        )}
      </div>
    </div>
  );
}
