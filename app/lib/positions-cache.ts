/**
 * Server-side UserPosition cache. Mirrors markets-cache: store raw account bytes
 * so decoding matches on-chain layout exactly, denormalize market/user for filtering.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getUserPositionDecoder } from "../generated/prediction_market/accounts/userPosition";
import { PREDICTION_MARKET_PROGRAM_ADDRESS } from "../generated/prediction_market";

/** Base58 memcmp filter for UserPosition accounts (Anchor 8-byte discriminator). */
export const USER_POSITION_DISCRIMINATOR_BASE58 = "j9SjDYAWesU";

export type RpcPositionRow = {
  address: string;
  marketAddress: string;
  userAddress: string;
  accountDataBase64: string;
};

export async function fetchPositionsFromRpc(rpcUrl: string): Promise<RpcPositionRow[]> {
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
                bytes: USER_POSITION_DISCRIMINATOR_BASE58,
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

  const decoder = getUserPositionDecoder();
  const out: RpcPositionRow[] = [];
  for (const account of result.result ?? []) {
    const b64 = account.account.data[0];
    if (!b64) continue;
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const decoded = decoder.decode(bytes);
      out.push({
        address: account.pubkey,
        marketAddress: decoded.market as string,
        userAddress: decoded.user as string,
        accountDataBase64: b64,
      });
    } catch (err) {
      console.warn("[positions-cache] decode failed for", account.pubkey, err);
    }
  }
  return out;
}

export async function readPositionsForUser(
  supabase: SupabaseClient,
  userAddress: string,
  marketAddress?: string,
): Promise<RpcPositionRow[]> {
  let query = supabase
    .from("positions_cache")
    .select("address, market_address, user_address, account_data_base64")
    .eq("user_address", userAddress);
  if (marketAddress) query = query.eq("market_address", marketAddress);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    address: r.address as string,
    marketAddress: r.market_address as string,
    userAddress: r.user_address as string,
    accountDataBase64: r.account_data_base64 as string,
  }));
}

export async function syncPositionsCache(
  supabase: SupabaseClient,
  rpcUrl: string,
): Promise<{ upserted: number; deleted: number }> {
  const rows = await fetchPositionsFromRpc(rpcUrl);
  const now = new Date().toISOString();
  const want = new Set(rows.map((r) => r.address));

  if (rows.length > 0) {
    const { error } = await supabase.from("positions_cache").upsert(
      rows.map((r) => ({
        address: r.address,
        market_address: r.marketAddress,
        user_address: r.userAddress,
        account_data_base64: r.accountDataBase64,
        updated_at: now,
      })),
      { onConflict: "address" },
    );
    if (error) throw error;
  }

  const { data: existing, error: selErr } = await supabase.from("positions_cache").select("address");
  if (selErr) throw selErr;

  const toDelete = (existing ?? [])
    .map((r) => r.address as string)
    .filter((a) => !want.has(a));

  if (toDelete.length > 0) {
    const { error: delErr } = await supabase.from("positions_cache").delete().in("address", toDelete);
    if (delErr) throw delErr;
  }

  return { upserted: rows.length, deleted: toDelete.length };
}
