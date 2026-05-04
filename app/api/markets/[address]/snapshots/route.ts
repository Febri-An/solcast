import { NextResponse } from "next/server";

import { createServiceSupabase, isSupabaseConfigured } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 400;
const MAX_LIMIT = 800;

export type SnapshotApiRow = {
  recorded_at: string;
  yes_bps: number;
  total_pool: string;
};

/**
 * GET /api/markets/[address]/snapshots?limit=400
 * Time-series implied YES probability (basis points) for charting.
 */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  const trimmed = address?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  let limit = DEFAULT_LIMIT;
  try {
    const u = new URL(request.url);
    const raw = u.searchParams.get("limit");
    if (raw) limit = Math.min(MAX_LIMIT, Math.max(1, Number(raw)));
  } catch {
    /* ignore */
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ snapshots: [] as SnapshotApiRow[] });
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("market_snapshots")
      .select("recorded_at, yes_bps, total_pool")
      .eq("market_address", trimmed)
      .order("recorded_at", { ascending: true })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      snapshots: (data ?? []) as SnapshotApiRow[],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load snapshots";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
