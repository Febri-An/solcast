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

export function formatUsdWhole(value: bigint): string {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
