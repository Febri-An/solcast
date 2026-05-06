/**
 * Dynamic slippage (basis points): scales with trade size vs pool liquidity,
 * capped by a user-chosen ceiling so whales can settle without implying 99% sandwich risk.
 */

const DEFAULT_BASE_BPS = 75; // 0.75%

export function clampBps(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * @param opts.maxCapBps — hard ceiling (e.g. 300 = 3%) from UI / settings.
 * @param opts.amountIn — buy: lamports in; omit for sells.
 * @param opts.sharesIn — sell: shares sold; omit for buys.
 */
export function computeDynamicSlippageBps(opts: {
  poolTotal: bigint;
  maxCapBps: number;
  amountIn?: bigint;
  sharesIn?: bigint;
  baseBps?: number;
}): number {
  const base = opts.baseBps ?? DEFAULT_BASE_BPS;
  const cap = clampBps(opts.maxCapBps, 50, 500);

  if (opts.poolTotal <= 0n) return clampBps(base, 50, cap);

  let sizeNumerator: bigint | undefined;
  if (opts.amountIn !== undefined && opts.amountIn > 0n) sizeNumerator = opts.amountIn;
  else if (opts.sharesIn !== undefined && opts.sharesIn > 0n)
    sizeNumerator = opts.sharesIn;

  if (sizeNumerator === undefined || sizeNumerator <= 0n) return clampBps(base, 50, cap);

  // Trade size as bps of total virtual pool (ratio * 10000), capped at 5000 (50%).
  let ratioBps = (sizeNumerator * 10000n) / opts.poolTotal;
  if (ratioBps > 5000n) ratioBps = 5000n;

  const impactExtra = Number((ratioBps * 35n) / 100n);
  const raw = base + impactExtra;
  return clampBps(Math.min(cap, Math.max(base, raw)), 50, cap);
}
