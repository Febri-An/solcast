import type { ReadonlyUint8Array } from "@solana/kit";

/** Pyth feed id (hex, no 0x) → TradingView symbol for the chart widget */
const FEED_HEX_TO_TRADINGVIEW: Record<string, string> = {
  e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43: "BINANCE:BTCUSDT",
  ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d: "BINANCE:SOLUSDT",
  ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace: "BINANCE:ETHUSDT",
};

const FEED_HEX_TO_LABEL: Record<string, string> = {
  e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43: "Bitcoin (BTC)",
  ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d: "Solana (SOL)",
  ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace: "Ethereum (ETH)",
};

export function feedIdBytesToHex(feedId: ReadonlyUint8Array): string {
  return Array.from(feedId)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function getTradingViewSymbolForFeed(feedId: ReadonlyUint8Array): string {
  const hex = feedIdBytesToHex(feedId);
  return FEED_HEX_TO_TRADINGVIEW[hex] ?? "BINANCE:BTCUSDT";
}

export function getAssetLabelForFeed(feedId: ReadonlyUint8Array): string {
  const hex = feedIdBytesToHex(feedId);
  return FEED_HEX_TO_LABEL[hex] ?? "Crypto asset";
}
