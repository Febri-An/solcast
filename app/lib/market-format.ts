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

export function formatUsdWhole(value: bigint): string {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Open for betting: not resolved and before resolution time. */
export function isOpenForBetting(market: { resolved: boolean; resolutionTime: bigint }): boolean {
  if (market.resolved) return false;
  return Date.now() / 1000 < Number(market.resolutionTime);
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
