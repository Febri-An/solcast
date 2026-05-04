/**
 * Client-side CPMM math — must match `anchor/programs/prediction_market/src/math.rs`
 * byte-for-byte so frontend quotes equal on-chain behaviour.
 *
 * All intermediates use `bigint` so we never lose precision relative to u128
 * on-chain math. No fee is applied to sell, matching the program.
 */

/** Babylonian integer sqrt for bigint. */
export function sqrtBigInt(n: bigint): bigint {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export type TradeQuote = {
  /** Shares the user receives (buy) or SOL out (sell), in lamports/shares (bigint). */
  out: bigint;
  /** Resulting pool reserves after the trade. */
  newYesShares: bigint;
  newNoShares: bigint;
  /** Implied price of YES (basis points, 0..10000). */
  impliedYesBps: number;
  /** Effective price paid per unit (basis points). For buy: cost per share. */
  effectivePriceBps: number;
};

export type TradeError =
  | "InvalidAmount"
  | "PoolDepleted"
  | "InsufficientShares"
  | "Overflow";

/** Returns the implied price of YES in basis points (0..10000). */
export function yesPriceBps(yesShares: bigint, noShares: bigint): number {
  const total = yesShares + noShares;
  if (total === 0n) return 5000;
  return Number((noShares * 10000n) / total);
}

/** Quote a buy: `amountIn` lamports of collateral → `out` winning shares. */
export function quoteBuy(
  yesShares: bigint,
  noShares: bigint,
  amountIn: bigint,
  buyYes: boolean,
  feeBps: number,
): TradeQuote | TradeError {
  if (amountIn <= 0n) return "InvalidAmount";
  if (yesShares <= 0n || noShares <= 0n) return "PoolDepleted";

  const fee = (amountIn * BigInt(feeBps)) / 10000n;
  const dNet = amountIn - fee;
  if (dNet <= 0n) return "InvalidAmount";

  const same = buyYes ? yesShares : noShares;
  const other = buyYes ? noShares : yesShares;

  const denom = other + dNet;
  const shares = (dNet * (same + other + dNet)) / denom;
  const newSame = (same * other) / denom;
  const newOther = denom;
  if (newSame <= 0n) return "PoolDepleted";

  const newYes = buyYes ? newSame : newOther;
  const newNo = buyYes ? newOther : newSame;

  return {
    out: shares,
    newYesShares: newYes,
    newNoShares: newNo,
    impliedYesBps: yesPriceBps(newYes, newNo),
    effectivePriceBps:
      shares > 0n ? Number((amountIn * 10000n) / shares) : 0,
  };
}

/** Quote a sell: `sharesIn` winning-side shares → `out` lamports. */
export function quoteSell(
  yesShares: bigint,
  noShares: bigint,
  sharesIn: bigint,
  sellYes: boolean,
): TradeQuote | TradeError {
  if (sharesIn <= 0n) return "InvalidAmount";
  if (yesShares <= 0n || noShares <= 0n) return "PoolDepleted";

  const same = sellYes ? yesShares : noShares;
  const other = sellYes ? noShares : yesShares;

  const B = same + other + sharesIn;
  const bSq = B * B;
  const fourDN = 4n * sharesIn * other;
  if (fourDN > bSq) return "Overflow";
  const disc = bSq - fourDN;
  const sqrtDisc = sqrtBigInt(disc);
  const X = (B - sqrtDisc) / 2n;

  const newSame = same + sharesIn - X;
  const newOther = other - X;
  if (newSame <= 0n || newOther <= 0n) return "PoolDepleted";

  const newYes = sellYes ? newSame : newOther;
  const newNo = sellYes ? newOther : newSame;

  return {
    out: X,
    newYesShares: newYes,
    newNoShares: newNo,
    impliedYesBps: yesPriceBps(newYes, newNo),
    effectivePriceBps:
      sharesIn > 0n ? Number((X * 10000n) / sharesIn) : 0,
  };
}

/** Apply a slippage tolerance to a quote's output (in basis points, e.g. 100 = 1%). */
export function applySlippage(out: bigint, slippageBps: number): bigint {
  const floor = (out * BigInt(10000 - slippageBps)) / 10000n;
  return floor < 0n ? 0n : floor;
}

export function isTradeError(q: TradeQuote | TradeError): q is TradeError {
  return typeof q === "string";
}
