import { NextResponse } from "next/server";

import { readMarketsCache } from "@/app/lib/markets-cache";
import { createServiceSupabase, isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets
 * - Read-only from `markets_cache` in Supabase.
 * - No RPC fallback and no automatic backfill from chain.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  try {
    const supabase = createServiceSupabase();
    const rows = await readMarketsCache(supabase);

    return NextResponse.json(
      { source: "cache", markets: rows },
      {
        headers: {
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load markets from cache";
    console.error("[api/markets] cache error:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
