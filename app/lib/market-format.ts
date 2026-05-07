export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / Number(LAMPORTS_PER_SOL);
  if (sol < 0.01) return sol.toFixed(4);
  return sol.toFixed(2);
}

export function formatVolume(lamports: bigint): string {
  const sol = Number(lamports) / Number(LAMPORTS_PER_SOL);
  if (sol >= 1000) return `${(sol / 1000).toFixed(1)}K`;
  if (sol >= 1) return sol.toFixed(1);
  if (sol >= 0.01) return sol.toFixed(2);
  return sol.toFixed(4);
}

export function formatMarketVaultSolDisplay(lamports: bigint | null | undefined): string {
  if (lamports === undefined || lamports === null) return "—";
  return formatVolume(lamports);
}

export function getTimeRemaining(resolutionTime: number): string {
  const now = Date.now() / 1000;
  const diff = resolutionTime - now;
  if (diff <= 0) return "Ended";
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** Remaining time as M:SS (floored whole seconds). Used for short-window live countdowns. */
export function formatCountdownMmSs(remainingSec: number): string {
  if (remainingSec <= 0) return "0:00";
  const total = Math.floor(remainingSec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function pad2(n: number): string {
  return Math.floor(Math.max(0, n)).toString().padStart(2, "0");
}

/**
 * Live resolution timer: hour+ as `2h 14m 03s`, under one hour as `00:59:03`.
 */
export function formatResolutionCountdownRemaining(diffSec: number): string {
  if (diffSec <= 0) return "Ended";
  const total = Math.floor(diffSec);
  if (total >= 3600) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}h ${m}m ${pad2(s)}s`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function formatUsdWhole(value: bigint): string {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** 1 USD == 1e9 nanodollars (matches on-chain encoding `target_price_encoding == 1`). */
export const USD_NANOS_PER_USD = 1_000_000_000n;

const I64_MAX = 9_223_372_036_854_775_807n;

/** `target_price` is whole USD (legacy). */
export const TARGET_PRICE_ENCODING_WHOLE_USD = 0;
/** `target_price` is USD × 1e9 (9 decimal places). */
export const TARGET_PRICE_ENCODING_NANODOLLARS = 1;

/**
 * Parse a US-style decimal amount from user input into nanodollars (no floats).
 * Up to 9 fractional digits; rejects values outside signed i64.
 */
export function usdInputToNanodollars(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!s) return null;
  const neg = s.startsWith("-");
  const rest = neg ? s.slice(1) : s;
  if (!rest) return null;
  const [wholeRaw, fracRaw = "", ...extra] = rest.split(".");
  if (extra.length > 0) return null;
  if (!/^\d*$/.test(wholeRaw) || !/^\d*$/.test(fracRaw)) return null;
  if (fracRaw.length > 9) return null;
  const whole = wholeRaw === "" ? 0n : BigInt(wholeRaw);
  const frac =
    fracRaw === "" ? 0n : BigInt((fracRaw + "000000000").slice(0, 9));
  const nanos = whole * USD_NANOS_PER_USD + frac;
  if (neg && nanos !== 0n) return null;
  if (nanos <= 0n) return null;
  if (nanos > I64_MAX) return null;
  return nanos;
}

function formatNanodollarsUsd(nanos: bigint): string {
  const neg = nanos < 0n;
  const v = neg ? -nanos : nanos;
  const whole = v / USD_NANOS_PER_USD;
  const frac = v % USD_NANOS_PER_USD;
  const wholeStr = whole.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (frac === 0n) {
    return `${neg ? "-" : ""}${wholeStr}`;
  }
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${wholeStr}.${fracStr}`;
}

/** Format on-chain target strike for display (detail page, keeper logs). */
export function formatMarketTargetUsd(
  targetPrice: bigint,
  targetPriceEncoding: number,
): string {
  if (targetPriceEncoding === TARGET_PRICE_ENCODING_NANODOLLARS) {
    return formatNanodollarsUsd(targetPrice);
  }
  return Number(targetPrice).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

/** Open for betting: not resolved and before resolution time. Pass `nowSec` when grouping lists so tabs stay accurate between refreshes. */
export function isOpenForBetting(
  market: { resolved: boolean; resolutionTime: bigint },
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (market.resolved) return false;
  return nowSec < Number(market.resolutionTime);
}

/**
 * Approximate initial duration in seconds from create form: resolutionTime − floor(marketId ms → s).
 * Matches 2m / 5m / 1h / 1d / 1w options when marketId is Date.now() at creation.
 */
export function inferInitialDurationSeconds(market: {
  marketId: bigint;
  resolutionTime: bigint;
}): number | null {
  const createdApproxSec = Math.floor(Number(market.marketId) / 1000);
  const resSec = Number(market.resolutionTime);
  const d = resSec - createdApproxSec;
  if (d < 30 || d > 86400 * 366) return null;
  return d;
}

/** Markets created with duration ≤ 5 minutes (2m / 5m) — show LIVE strip. */
export function isShortLiveWindowMarket(market: { marketId: bigint; resolutionTime: bigint }): boolean {
  const d = inferInitialDurationSeconds(market);
  if (d === null) return false;
  return d <= 5 * 60;
}
