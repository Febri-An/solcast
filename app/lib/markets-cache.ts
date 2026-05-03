/**
 * Server-side market list: fetch from Solana RPC and/or Supabase `markets_cache`.
 * Stores raw account bytes (base64) so decoding matches on-chain layout (bigint / Option).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getMarketDecoder, PREDICTION_MARKET_PROGRAM_ADDRESS, type Market } from "../generated/prediction_market";
import type { Address } from "@solana/kit";
import { yesPriceBps } from "./amm-math";

/** Base58 memcmp filter for Market accounts (Anchor 8-byte discriminator). */
export const MARKET_DISCRIMINATOR_BASE58 = "dkokXHR3DTw";

export type RpcMarketRow = {
  address: string;
  accountDataBase64: string;
};

export async function fetchMarketsFromRpc(rpcUrl: string): Promise<RpcMarketRow[]> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getProgramAccounts",
      params: [
        PREDICTION_MARKET_PROGRAM_ADDRESS,
        {
          encoding: "base64",
          commitment: "confirmed",
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: MARKET_DISCRIMINATOR_BASE58,
              },
            },
          ],
        },
      ],
    }),
  });

  const result = (await response.json()) as {
    error?: { message: string };
    result?: Array<{ pubkey: string; account: { data: [string, string] } }>;
  };

  if (result.error) {
    throw new Error(result.error.message);
  }

  const out: RpcMarketRow[] = [];
  for (const account of result.result ?? []) {
    const b64 = account.account.data[0];
    if (!b64) continue;
    out.push({ address: account.pubkey, accountDataBase64: b64 });
  }
  return out;
}

export function decodeMarketRow(row: RpcMarketRow): { address: Address; market: Market } {
  const data = Uint8Array.from(atob(row.accountDataBase64), (c) => c.charCodeAt(0));
  const market = getMarketDecoder().decode(data);
  return { address: row.address as Address, market };
}

export async function readMarketsCache(supabase: SupabaseClient): Promise<RpcMarketRow[]> {
  const { data, error } = await supabase
    .from("markets_cache")
    .select("address, account_data_base64")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((r) => ({
    address: r.address as string,
    accountDataBase64: r.account_data_base64 as string,
  }));
}

export async function readMarketFromCache(
  supabase: SupabaseClient,
  address: string,
): Promise<RpcMarketRow | null> {
  const { data, error } = await supabase
    .from("markets_cache")
    .select("address, account_data_base64")
    .eq("address", address)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    address: data.address as string,
    accountDataBase64: data.account_data_base64 as string,
  };
}

export async function fetchMarketFromRpc(
  rpcUrl: string,
  address: string,
): Promise<RpcMarketRow | null> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [address, { encoding: "base64", commitment: "confirmed" }],
    }),
  });

  const result = (await response.json()) as {
    error?: { message: string };
    result?: { value: { data: [string, string] } | null };
  };

  if (result.error) {
    throw new Error(result.error.message);
  }
  const b64 = result.result?.value?.data?.[0];
  if (!b64) return null;
  return { address, accountDataBase64: b64 };
}

/** Anchor point when odds are unchanged — avoids spamming identical rows every keeper tick. */
const SNAPSHOT_HEARTBEAT_MS = 300_000;

export async function maybeInsertMarketSnapshot(
  supabase: SupabaseClient,
  row: RpcMarketRow,
): Promise<void> {
  try {
    const { market } = decodeMarketRow(row);
    const yes = market.yesShares;
    const no = market.noShares;
    const yesBps = yesPriceBps(yes, no);
    const totalPool = yes + no;

    const { data: lastRow, error: selErr } = await supabase
      .from("market_snapshots")
      .select("yes_bps, total_pool, recorded_at")
      .eq("market_address", row.address)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selErr) {
      console.warn("[market_snapshots] select last:", selErr.message);
      return;
    }

    const now = Date.now();

    if (lastRow) {
      const lastBps = lastRow.yes_bps as number;
      const lastPoolStr = String(lastRow.total_pool ?? "0");
      const lastPool = BigInt(lastPoolStr);
      const lastAt = new Date(lastRow.recorded_at as string).getTime();

      const stateChanged = lastBps !== yesBps || lastPool !== totalPool;
      const heartbeatDue = now - lastAt >= SNAPSHOT_HEARTBEAT_MS;

      if (!stateChanged && !heartbeatDue) return;
    }

    const { error: insErr } = await supabase.from("market_snapshots").insert({
      market_address: row.address,
      yes_bps: yesBps,
      total_pool: totalPool.toString(),
      recorded_at: new Date().toISOString(),
    });

    if (insErr) console.warn("[market_snapshots] insert:", insErr.message);
  } catch (err) {
    console.warn("[market_snapshots]", row.address, (err as Error).message);
  }
}

/** Upsert a single market row (used by detail API to keep cache fresh). */
export async function upsertMarketRow(
  supabase: SupabaseClient,
  row: RpcMarketRow,
): Promise<void> {
  const { error } = await supabase.from("markets_cache").upsert(
    {
      address: row.address,
      account_data_base64: row.accountDataBase64,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "address" },
  );
  if (error) throw error;
  await maybeInsertMarketSnapshot(supabase, row);
}

/**
 * Full sync: RPC snapshot → upsert → delete rows removed on-chain.
 */
export async function syncMarketsCache(
  supabase: SupabaseClient,
  rpcUrl: string,
): Promise<{ upserted: number; deleted: number }> {
  const rows = await fetchMarketsFromRpc(rpcUrl);
  const now = new Date().toISOString();
  const want = new Set(rows.map((r) => r.address));

  if (rows.length > 0) {
    const { error } = await supabase.from("markets_cache").upsert(
      rows.map((r) => ({
        address: r.address,
        account_data_base64: r.accountDataBase64,
        updated_at: now,
      })),
      { onConflict: "address" },
    );
    if (error) throw error;
  }

  for (const r of rows) {
    await maybeInsertMarketSnapshot(supabase, r);
  }

  const { data: existing, error: selErr } = await supabase.from("markets_cache").select("address");
  if (selErr) throw selErr;

  const toDelete = (existing ?? [])
    .map((r) => r.address as string)
    .filter((a) => !want.has(a));

  if (toDelete.length > 0) {
    const { error: delErr } = await supabase.from("markets_cache").delete().in("address", toDelete);
    if (delErr) throw delErr;
  }

  return { upserted: rows.length, deleted: toDelete.length };
}
