/**
 * Prediction market auto-resolve keeper bot.
 *
 * Scans the program for expired-but-unresolved markets and resolves them
 * permissionlessly using Pyth price updates. The outcome is determined
 * on-chain based on the market's stored target_price vs. the Pyth price
 * at (approximately) the market's resolution timestamp.
 *
 * Run:
 *   npm run keeper:dry     # dry-run: log what would be resolved
 *   npm run keeper:start   # execute resolves
 */

import { Connection } from "@solana/web3.js";
import { isSome } from "@solana/kit";

import { loadConfig, type KeeperConfig } from "./config";
import { loadKeypair, keypairWallet } from "./wallet";
import { fetchAllMarkets, type MarketRecord } from "./markets";
import { resolveMarketWithPyth } from "../../app/lib/pyth";
import { formatMarketTargetUsd } from "../../app/lib/market-format";
import {
  fetchMarketFromRpc,
  upsertMarketRow,
} from "../../app/lib/markets-cache";
import { makeSupabaseClient, runCacheSyncOnce } from "./cache-sync";
import type { SupabaseClient } from "@supabase/supabase-js";

const PRICE_TIMESTAMP_TOLERANCE_SECONDS = 30;
const RESOLVE_GRACE_PERIOD_SECONDS = 30 * 60;

type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

function checkEligibility(
  record: MarketRecord,
  nowSec: number,
  minLiquidityLamports: bigint,
): Eligibility {
  const m = record.data;

  if (m.resolved) return { eligible: false, reason: "already resolved" };

  const resolution = Number(m.resolutionTime);
  if (nowSec < resolution) {
    return { eligible: false, reason: `not expired (in ${resolution - nowSec}s)` };
  }

  if (nowSec > resolution + RESOLVE_GRACE_PERIOD_SECONDS) {
    return { eligible: false, reason: "grace period closed" };
  }

  // Only start attempting once Hermes is likely to have a price near the deadline.
  if (nowSec < resolution + PRICE_TIMESTAMP_TOLERANCE_SECONDS) {
    return {
      eligible: false,
      reason: `waiting for Hermes price window (+${resolution + PRICE_TIMESTAMP_TOLERANCE_SECONDS - nowSec}s)`,
    };
  }

  // AMM pool size (virtual share count) — keep the same threshold meaning.
  const totalPool = m.yesShares + m.noShares;
  if (totalPool < minLiquidityLamports) {
    return {
      eligible: false,
      reason: `below min liquidity (${totalPool} < ${minLiquidityLamports} lamports)`,
    };
  }

  return { eligible: true };
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function logMarket(record: MarketRecord, nowSec: number): string {
  const m = record.data;
  const addr = record.address.toBase58();
  const secLeft = Number(m.resolutionTime) - nowSec;
  const outcomeStr = isSome(m.outcome)
    ? m.outcome.value
      ? "YES"
      : "NO"
    : "—";
  const targetLabel = formatMarketTargetUsd(m.targetPrice, m.targetPriceEncoding);
  return `${shortAddr(addr)} | "${m.question}" | target=$${targetLabel} | pool=${m.yesShares + m.noShares} | t${secLeft >= 0 ? "-" : "+"}${Math.abs(secLeft)}s | resolved=${m.resolved} outcome=${outcomeStr}`;
}

/**
 * Push a single resolved market row into `markets_cache` so realtime
 * subscribers see the outcome within ~100 ms (rather than waiting for
 * the next full reconciliation sweep).
 */
async function writeThroughMarket(
  supabase: SupabaseClient | null,
  rpcUrl: string,
  address: string,
): Promise<void> {
  if (!supabase) return;
  try {
    const row = await fetchMarketFromRpc(rpcUrl, address);
    if (row) await upsertMarketRow(supabase, row);
  } catch (err) {
    console.warn(
      `[write-through] failed to upsert ${shortAddr(address)}:`,
      (err as Error).message,
    );
  }
}

async function runCycle(
  config: KeeperConfig,
  connection: Connection,
  wallet: ReturnType<typeof keypairWallet>,
  inFlight: Set<string>,
  supabase: SupabaseClient | null,
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const markets = await fetchAllMarkets(connection, config.programId);

  if (config.verbose) {
    console.log(`[cycle] Found ${markets.length} markets total`);
    for (const m of markets) console.log(`   ${logMarket(m, nowSec)}`);
  }

  const eligible: MarketRecord[] = [];
  for (const rec of markets) {
    const addr = rec.address.toBase58();
    if (inFlight.has(addr)) continue;
    const check = checkEligibility(rec, nowSec, config.minLiquidityLamports);
    if (check.eligible) {
      eligible.push(rec);
    } else if (config.verbose) {
      console.log(`[skip] ${shortAddr(addr)}: ${check.reason}`);
    }
  }

  if (eligible.length === 0) {
    console.log(`[cycle] No eligible markets (checked ${markets.length})`);
    return;
  }

  const batch = eligible.slice(0, config.maxMarketsPerCycle);
  console.log(
    `[cycle] ${eligible.length} eligible, resolving ${batch.length} this cycle${config.dryRun ? " (DRY RUN)" : ""}`,
  );

  for (const rec of batch) {
    const addr = rec.address.toBase58();
    console.log(`[resolve] ${logMarket(rec, nowSec)}`);

    if (config.dryRun) continue;

    inFlight.add(addr);
    try {
      const sigs = await resolveMarketWithPyth(
        connection,
        wallet,
        addr,
        rec.data.feedId,
        Number(rec.data.resolutionTime),
      );
      console.log(`[ok] ${shortAddr(addr)} resolved; signatures: ${sigs.join(", ")}`);
      // Immediately write-through to Supabase so users see "resolved" within
      // ~500 ms, without waiting for the next full-sync cycle.
      void writeThroughMarket(supabase, config.rpcUrl, addr);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // Expected races / transient failures we can tolerate
      if (
        msg.includes("AlreadyResolved") ||
        msg.includes("custom program error: 0x1771") // 6001 = AlreadyResolved (adjust if errors shift)
      ) {
        console.log(`[race] ${shortAddr(addr)} already resolved by someone else`);
      } else if (msg.includes("ResolveWindowClosed")) {
        console.warn(`[closed] ${shortAddr(addr)} grace period closed mid-flight`);
      } else if (msg.includes("InvalidPriceTimestamp")) {
        console.warn(
          `[pyth] ${shortAddr(addr)} price publish_time outside ±${PRICE_TIMESTAMP_TOLERANCE_SECONDS}s tolerance; skipping`,
        );
      } else {
        console.error(`[fail] ${shortAddr(addr)}:`, msg);
      }
    } finally {
      inFlight.delete(addr);
    }
  }
}

function startCacheSync(
  config: KeeperConfig,
): { stop: () => void; supabase: SupabaseClient | null } {
  const { enabled, intervalMs, supabaseUrl, serviceRoleKey } = config.cacheSync;
  if (!enabled) {
    if (!supabaseUrl || !serviceRoleKey) {
      console.log(
        "[cache-sync] disabled (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set)",
      );
    } else {
      console.log("[cache-sync] disabled via KEEPER_CACHE_SYNC_DISABLED=true");
    }
    return { stop: () => {}, supabase: null };
  }

  const supabase: SupabaseClient = makeSupabaseClient(supabaseUrl!, serviceRoleKey!);
  let running = false;

  const tick = async () => {
    if (running) {
      // Previous sync still in flight — skip this tick, try again next interval.
      return;
    }
    running = true;
    try {
      const { markets, positions, durationMs } = await runCacheSyncOnce(
        supabase,
        config.rpcUrl,
      );
      console.log(
        `[cache-sync] markets skipped (${markets.reason}) | positions skipped (${positions.reason}) | ${durationMs}ms`,
      );
    } catch (err) {
      console.error("[cache-sync] failed:", (err as Error).message);
    } finally {
      running = false;
    }
  };

  void tick();
  const handle = setInterval(tick, intervalMs);
  return {
    stop: () => clearInterval(handle),
    supabase,
  };
}

async function main() {
  const config = loadConfig();
  const kp = loadKeypair(config.keypairPath);
  const wallet = keypairWallet(kp);
  const connection = new Connection(config.rpcUrl, "confirmed");

  console.log("=== Prediction Market Keeper ===");
  console.log(`RPC:            ${config.rpcUrl}`);
  console.log(`Program:        ${config.programId.toBase58()}`);
  console.log(`Keeper wallet:  ${kp.publicKey.toBase58()}`);
  console.log(`Min liquidity:  ${config.minLiquidityLamports} lamports`);
  console.log(`Poll interval:  ${config.pollIntervalMs}ms`);
  console.log(`Max per cycle:  ${config.maxMarketsPerCycle}`);
  console.log(`Dry run:        ${config.dryRun}`);
  console.log(
    `Cache sync:     ${config.cacheSync.enabled ? `ON every ${config.cacheSync.intervalMs}ms` : "OFF"}`,
  );
  console.log("================================");

  try {
    const balance = await connection.getBalance(kp.publicKey);
    console.log(`[startup] keeper balance: ${(balance / 1e9).toFixed(4)} SOL`);
    if (balance < 0.05 * 1e9 && !config.dryRun) {
      console.warn(
        "[startup] WARNING: keeper balance is low (<0.05 SOL). Fund the wallet to keep resolving.",
      );
    }
  } catch (err) {
    console.error("[startup] failed to fetch keeper balance:", (err as Error).message);
  }

  const inFlight = new Set<string>();
  let stopping = false;

  const cacheSync = startCacheSync(config);
  const supabase = cacheSync.supabase;

  const shutdown = (sig: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[shutdown] received ${sig}, exiting after current cycle…`);
    cacheSync.stop();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!stopping) {
    try {
      await runCycle(config, connection, wallet, inFlight, supabase);
    } catch (err) {
      console.error("[cycle] unexpected error:", (err as Error).message);
    }
    if (stopping) break;
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }

  cacheSync.stop();
  console.log("[shutdown] bye");
  process.exit(0);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
