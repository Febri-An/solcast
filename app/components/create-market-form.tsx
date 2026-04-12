"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";

import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";

import { getCreateMarketInstructionAsync } from "../generated/prediction_market";

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

    try {
      setTxStatus("Creating market...");

      const marketId = BigInt(Date.now());
      const nowInSeconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
      const durationInSeconds = parseInt(durationMinutes) * SECONDS_PER_MINUTE;
      const resolutionTime = BigInt(nowInSeconds + durationInSeconds);

      const feedIdBytes = hexToBytes(feed.feedId);

      const instruction = await getCreateMarketInstructionAsync({
        creator: wallet.account,
        marketId,
        question,
        resolutionTime,
        feedId: feedIdBytes,
        targetPrice: BigInt(Math.floor(priceNum)),
      });

      const signature = await send({ instructions: [instruction] });

      setTxStatus(`Created! ${signature?.slice(0, 8)}...`);
      setTargetPrice("");
      setTimeout(() => {
        setTxStatus(null);
        onCreated?.();
      }, 1500);
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
  ]);

  if (status !== "connected") {
    return (
      <div className="rounded-xl border border-border-low bg-card p-4">
        <p className="text-sm text-muted text-center">
          Connect your wallet to create a market
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-low bg-card p-4 space-y-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-muted mb-1.5">
            Asset
          </label>
          <select
            value={selectedFeed}
            onChange={(e) => setSelectedFeed(e.target.value)}
            disabled={isSending}
            className="w-full rounded-md border border-border-low bg-card px-3 py-2 text-sm outline-none focus:border-foreground/30 disabled:opacity-60"
          >
            {PRICE_FEEDS.map((f) => (
              <option key={f.feedId} value={f.feedId}>
                {f.label} ({f.symbol}/USD)
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-muted mb-1.5">
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
            className="w-full rounded-md border border-border-low bg-card px-3 py-2 text-sm outline-none placeholder:text-muted/60 focus:border-foreground/30 disabled:opacity-60"
          />
        </div>
      </div>

      {question && (
        <p className="text-sm font-medium">
          {question}
        </p>
      )}

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-muted mb-1.5">
            Betting ends in
          </label>
          <select
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            disabled={isSending}
            className="w-full rounded-md border border-border-low bg-card px-3 py-2 text-sm outline-none focus:border-foreground/30 disabled:opacity-60"
          >
            <option value="2">2 minutes</option>
            <option value="5">5 minutes</option>
            <option value="60">1 hour</option>
            <option value="1440">1 day</option>
            <option value="10080">1 week</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={handleCreate}
            disabled={isSending || !isValidPrice}
            className="rounded-md bg-foreground px-6 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-40"
          >
            {isSending ? "..." : "Create"}
          </button>
        </div>
      </div>

      {txStatus && <p className="text-xs text-muted">{txStatus}</p>}
    </div>
  );
}
