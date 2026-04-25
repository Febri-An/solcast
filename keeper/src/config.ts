import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { PublicKey } from "@solana/web3.js";

const KEEPER_DIR = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(KEEPER_DIR, "..");

// Load keeper-specific .env first (higher priority), then the project-root .env
// so Supabase credentials shared with the Next.js app are picked up automatically.
dotenv.config({ path: path.join(KEEPER_DIR, ".env") });
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

export type KeeperConfig = {
  rpcUrl: string;
  keypairPath: string;
  programId: PublicKey;
  minLiquidityLamports: bigint;
  pollIntervalMs: number;
  maxMarketsPerCycle: number;
  dryRun: boolean;
  verbose: boolean;
  cacheSync: {
    enabled: boolean;
    intervalMs: number;
    supabaseUrl?: string;
    serviceRoleKey?: string;
  };
};

function expandPath(input: string): string {
  if (input.startsWith("~")) {
    return path.join(os.homedir(), input.slice(1));
  }
  return path.resolve(input);
}

function parseNumber(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for ${name}: ${value}`);
  }
  return n;
}

export function loadConfig(): KeeperConfig {
  const rpcUrl = process.env.KEEPER_RPC_URL ?? "https://api.devnet.solana.com";
  const keypairPath = expandPath(
    process.env.KEEPER_KEYPAIR_PATH ?? "~/.config/solana/id.json",
  );

  if (!fs.existsSync(keypairPath)) {
    throw new Error(
      `Keypair file not found at ${keypairPath}. Set KEEPER_KEYPAIR_PATH in keeper/.env`,
    );
  }

  const programIdStr =
    process.env.KEEPER_PROGRAM_ID ?? "DYy72hMhhyHvbPjy71pp4137U4FumNuzM6i3mLVU2MWk";
  let programId: PublicKey;
  try {
    programId = new PublicKey(programIdStr);
  } catch {
    throw new Error(`Invalid KEEPER_PROGRAM_ID: ${programIdStr}`);
  }

  const minLiquiditySol = parseNumber(
    "KEEPER_MIN_LIQUIDITY_SOL",
    process.env.KEEPER_MIN_LIQUIDITY_SOL,
    0.01,
  );
  const minLiquidityLamports = BigInt(Math.floor(minLiquiditySol * 1e9));

  const pollIntervalMs = parseNumber(
    "KEEPER_POLL_INTERVAL_MS",
    process.env.KEEPER_POLL_INTERVAL_MS,
    15_000,
  );

  const maxMarketsPerCycle = parseNumber(
    "KEEPER_MAX_MARKETS_PER_CYCLE",
    process.env.KEEPER_MAX_MARKETS_PER_CYCLE,
    5,
  );

  const dryRun =
    process.argv.includes("--dry-run") || process.env.KEEPER_DRY_RUN === "true";
  const verbose =
    process.argv.includes("--verbose") || process.env.KEEPER_VERBOSE === "true";

  const cacheSyncIntervalMs = parseNumber(
    "KEEPER_CACHE_SYNC_INTERVAL_MS",
    process.env.KEEPER_CACHE_SYNC_INTERVAL_MS,
    // Full reconciliation interval. Write-through from the app handles the
    // common case (<500 ms post-tx), so this only needs to catch external
    // trades (CLI users, other clients) and keeper resolves.
    10_000,
  );
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
  // Default ON when Supabase is configured and user hasn't explicitly disabled it.
  const cacheSyncDisabled = process.env.KEEPER_CACHE_SYNC_DISABLED === "true";
  const cacheSyncEnabled =
    !cacheSyncDisabled && Boolean(supabaseUrl && serviceRoleKey);

  return {
    rpcUrl,
    keypairPath,
    programId,
    minLiquidityLamports,
    pollIntervalMs,
    maxMarketsPerCycle,
    dryRun,
    verbose,
    cacheSync: {
      enabled: cacheSyncEnabled,
      intervalMs: cacheSyncIntervalMs,
      supabaseUrl,
      serviceRoleKey,
    },
  };
}
