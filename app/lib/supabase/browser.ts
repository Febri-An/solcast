"use client";

/**
 * Browser-side Supabase client (singleton). Uses the anon key and relies on
 * RLS policies for safety — caches expose read-only data (markets_cache,
 * positions_cache) that mirrors on-chain accounts.
 *
 * Centralised here so every realtime hook reuses the same WebSocket
 * connection instead of opening one per subscription.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function isBrowserSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}

export function getBrowserSupabase(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      params: {
        eventsPerSecond: 20,
      },
    },
  });
  return client;
}
